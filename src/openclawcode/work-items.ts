import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectProjectBlueprintClarifications,
  readProjectBlueprintDocument,
  type ProjectBlueprintRoleAssignments,
  type ProjectBlueprintStatus,
} from "./blueprint.js";
import { buildProjectWorkItemIssueMarkers } from "./issue-materialization.js";

export const PROJECT_WORK_ITEM_SCHEMA_VERSION = 1;
export const PROJECT_WORK_ITEM_STATUSES = [
  "planned",
  "queued",
  "in-progress",
  "blocked",
  "completed",
  "canceled",
] as const;
export const PROJECT_WORK_ITEM_KINDS = ["planned", "discovered"] as const;
export const PROJECT_WORK_ITEM_EXECUTION_MODES = [
  "feature",
  "bugfix",
  "refactor",
  "research",
] as const;

export type ProjectWorkItemStatus = (typeof PROJECT_WORK_ITEM_STATUSES)[number];
export type ProjectWorkItemKind = (typeof PROJECT_WORK_ITEM_KINDS)[number];
export type ProjectWorkItemExecutionMode = (typeof PROJECT_WORK_ITEM_EXECUTION_MODES)[number];

export interface ProjectWorkItemIssueDraft {
  title: string;
  body: string;
}

export interface ProjectWorkItem {
  id: string;
  kind: ProjectWorkItemKind;
  status: ProjectWorkItemStatus;
  executionMode: ProjectWorkItemExecutionMode;
  title: string;
  summary: string;
  source: "blueprint";
  sourceSection: "Workstreams";
  workstreamIndex: number;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  acceptanceCriteria: string[];
  openQuestions: string[];
  humanGates: string[];
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
  githubIssueDraft: ProjectWorkItemIssueDraft;
}

export interface ProjectWorkItemInventory {
  repoRoot: string;
  inventoryPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintTitle: string | null;
  blueprintStatus: ProjectBlueprintStatus | null;
  blueprintRevisionId: string | null;
  currentBlueprintRevisionId: string | null;
  artifactStale: boolean | null;
  readyForExecution: boolean;
  readyForIssueProjection: boolean;
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
  workItemCount: number;
  plannedWorkItemCount: number;
  discoveredWorkItemCount: number;
  workItems: ProjectWorkItem[];
}

function normalizeMarkdownListItem(line: string): string | null {
  const trimmed = line.trim();
  const match =
    trimmed.match(/^[-*]\s+\[(?: |x|X)\]\s+(.+)$/) ??
    trimmed.match(/^[-*]\s+(.+)$/) ??
    trimmed.match(/^\d+\.\s+(.+)$/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractMarkdownListItems(content: string | undefined): string[] {
  if (!content) {
    return [];
  }
  return content
    .split("\n")
    .map((line) => normalizeMarkdownListItem(line))
    .filter((item): item is string => Boolean(item))
    .filter((item) => !/^none\b/i.test(item));
}

function slugifyWorkItemIdSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function classifyProjectWorkItemExecutionMode(workItem: string): ProjectWorkItemExecutionMode {
  if (/\b(fix|bug|regression|broken|crash|error|failure)\b/i.test(workItem)) {
    return "bugfix";
  }
  if (
    /\b(refactor|cleanup|clean up|rename|extract|restructure|reorganize|dedupe|simplify)\b/i.test(
      workItem,
    )
  ) {
    return "refactor";
  }
  if (/\b(investigate|diagnose|triage|research|spike|explore)\b/i.test(workItem)) {
    return "research";
  }
  return "feature";
}

function buildDeliveryPolicyLines(
  executionMode: ProjectWorkItemExecutionMode,
): string[] {
  const base = [
    "- Keep this work item as one demoable vertical slice.",
    "- Prefer the smallest user-visible or operator-visible change that proves progress.",
    "- Avoid splitting the work into front-end-only, back-end-only, or tests-only subprojects unless the blueprint explicitly requires it.",
  ];
  if (executionMode === "research") {
    return [
      ...base,
      "- End with a recommendation or next executable slice instead of leaving an open-ended investigation.",
    ];
  }
  return base;
}

function buildTestingPolicyLines(
  executionMode: ProjectWorkItemExecutionMode,
): string[] {
  const lines = [
    "- Start with a failing proof or executable check when practical.",
    "- Prefer public-behavior tests, CLI proofs, or chat-visible verification over implementation-only assertions.",
    "- Follow a red -> green -> refactor loop and keep the proof green before broadening scope.",
  ];
  if (executionMode === "refactor") {
    lines.push("- Preserve existing behavior unless the acceptance criteria explicitly say otherwise.");
  }
  return lines;
}

function buildExecutionModeSpecificLines(
  executionMode: ProjectWorkItemExecutionMode,
): { heading: string; lines: string[] } | null {
  switch (executionMode) {
    case "bugfix":
      return {
        heading: "Bug triage expectations",
        lines: [
          "- Record the observed behavior, the expected behavior, and the smallest known reproduction path.",
          "- Identify the likely root-cause area before broad code changes.",
          "- Add a regression proof before or alongside the fix so the failure cannot silently return.",
        ],
      };
    case "refactor":
      return {
        heading: "Refactor guardrails",
        lines: [
          "- Keep the repository working after each small checkpoint.",
          "- Preserve external behavior unless a success criterion explicitly changes it.",
          "- Separate structural movement from behavior changes whenever the work can be split safely.",
        ],
      };
    case "research":
      return {
        heading: "Research exit criteria",
        lines: [
          "- End with a concrete recommendation, not only observations.",
          "- Name the next smallest executable slice once the investigation is complete.",
        ],
      };
    default:
      return null;
  }
}

function resolveProjectWorkItemIssueDraft(params: {
  blueprintTitle: string | null;
  blueprintGoal: string | null;
  blueprintRevisionId: string | null;
  workItemId: string;
  workItem: string;
  executionMode: ProjectWorkItemExecutionMode;
  acceptanceCriteria: string[];
  openQuestions: string[];
  humanGates: string[];
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
}): ProjectWorkItemIssueDraft {
  const providerLines = [
    ["Planner", params.providerRoleAssignments.planner],
    ["Coder", params.providerRoleAssignments.coder],
    ["Reviewer", params.providerRoleAssignments.reviewer],
    ["Verifier", params.providerRoleAssignments.verifier],
    ["Doc-writer", params.providerRoleAssignments.docWriter],
  ]
    .filter(([, assignment]) => assignment != null && assignment.length > 0)
    .map(([role, assignment]) => `- ${role}: ${assignment}`);

  const acceptanceCriteriaLines =
    params.acceptanceCriteria.length > 0
      ? params.acceptanceCriteria.map((item) => `- ${item}`)
      : ["- Reuse or refine the success criteria from the blueprint."];
  const openQuestionLines =
    params.openQuestions.length > 0
      ? params.openQuestions.map((item) => `- ${item}`)
      : ["- None recorded."];
  const humanGateLines =
    params.humanGates.length > 0
      ? params.humanGates.map((item) => `- ${item}`)
      : ["- Follow the default autonomous policy for this repository."];
  const executionModeLabel = params.executionMode.replace(/(^|-)([a-z])/g, (_match, dash, char) =>
    `${dash}${String(char).toUpperCase()}`,
  );
  const deliveryPolicyLines = buildDeliveryPolicyLines(params.executionMode);
  const testingPolicyLines = buildTestingPolicyLines(params.executionMode);
  const executionModeSpecific = buildExecutionModeSpecificLines(params.executionMode);

  return {
    title: `[Blueprint]: ${params.workItem}`,
    body: [
      "Summary",
      params.workItem,
      "",
      "Blueprint context",
      `- Blueprint: ${params.blueprintTitle ?? "Untitled project blueprint"}`,
      `- Revision: ${params.blueprintRevisionId ?? "unknown"}`,
      `- Goal: ${params.blueprintGoal ?? "No goal summary recorded."}`,
      `- Execution mode: ${executionModeLabel}`,
      "",
      "Acceptance criteria",
      ...acceptanceCriteriaLines,
      "",
      "Delivery policy",
      ...deliveryPolicyLines,
      "",
      "Testing policy",
      ...testingPolicyLines,
      "",
      ...(executionModeSpecific
        ? [executionModeSpecific.heading, ...executionModeSpecific.lines, ""]
        : []),
      "Open questions",
      ...openQuestionLines,
      "",
      "Human gates",
      ...humanGateLines,
      "",
      "Provider strategy",
      ...(providerLines.length > 0
        ? providerLines
        : ["- No explicit provider-role assignments recorded in PROJECT-BLUEPRINT.md."]),
      "",
      ...buildProjectWorkItemIssueMarkers({
        workItemId: params.workItemId,
        blueprintRevisionId: params.blueprintRevisionId,
      }),
    ].join("\n"),
  };
}

function emptyProjectWorkItemInventory(params: {
  repoRoot: string;
  inventoryPath: string;
  blueprintPath: string;
  blueprintExists: boolean;
  blueprintTitle: string | null;
  blueprintStatus: ProjectBlueprintStatus | null;
  blueprintRevisionId: string | null;
  currentBlueprintRevisionId: string | null;
}): ProjectWorkItemInventory {
  return {
    repoRoot: params.repoRoot,
    inventoryPath: params.inventoryPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintTitle: params.blueprintTitle,
    blueprintStatus: params.blueprintStatus,
    blueprintRevisionId: params.blueprintRevisionId,
    currentBlueprintRevisionId: params.currentBlueprintRevisionId,
    artifactStale: null,
    readyForExecution: false,
    readyForIssueProjection: false,
    blockerCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
    workItemCount: 0,
    plannedWorkItemCount: 0,
    discoveredWorkItemCount: 0,
    workItems: [],
  };
}

export function resolveProjectWorkItemInventoryPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "work-items.json");
}

export async function deriveProjectWorkItemInventory(
  repoRootInput: string,
): Promise<ProjectWorkItemInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectWorkItemInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const clarificationReport = await inspectProjectBlueprintClarifications(repoRoot);
  const blockers = new Set<string>(clarificationReport.questions);
  const suggestions = new Set<string>(clarificationReport.suggestions);

  if (!blueprint.exists) {
    const inventory = emptyProjectWorkItemInventory({
      repoRoot,
      inventoryPath,
      blueprintPath: blueprint.blueprintPath,
      blueprintExists: false,
      blueprintTitle: null,
      blueprintStatus: null,
      blueprintRevisionId: null,
      currentBlueprintRevisionId: null,
    });
    inventory.blockers = [...blockers];
    inventory.blockerCount = inventory.blockers.length;
    inventory.suggestions = [...suggestions];
    inventory.suggestionCount = inventory.suggestions.length;
    return inventory;
  }

  const workstreamItems = extractMarkdownListItems(blueprint.sectionBodies.Workstreams);
  const acceptanceCriteria = extractMarkdownListItems(blueprint.sectionBodies["Success Criteria"]);
  const openQuestions = extractMarkdownListItems(blueprint.sectionBodies["Open Questions"]);
  const humanGates = extractMarkdownListItems(blueprint.sectionBodies["Human Gates"]);

  if (workstreamItems.length === 0) {
    blockers.add(
      "Add at least one concrete bullet under `Workstreams` before decomposing execution work items.",
    );
  }

  if (!blueprint.hasAgreementCheckpoint) {
    blockers.add(
      "Record blueprint agreement with `openclaw code blueprint-set-status --status agreed` before autonomous issue projection.",
    );
  }

  if (openQuestions.length > 0) {
    blockers.add(
      "Resolve or explicitly clear the remaining `Open Questions` before autonomous issue projection.",
    );
  }

  if (blueprint.status === "superseded") {
    blockers.add(
      "The current blueprint is marked `superseded`; create or activate a new blueprint first.",
    );
  }

  const generatedAt = new Date().toISOString();
  const workItems = workstreamItems.map((workstream, index) => {
    const id = `planned-${String(index + 1).padStart(2, "0")}-${slugifyWorkItemIdSegment(
      workstream,
    )}`;
    const executionMode = classifyProjectWorkItemExecutionMode(workstream);
    return {
      id,
      kind: "planned" as const,
      status: "planned" as const,
      executionMode,
      title: workstream,
      summary: workstream,
      source: "blueprint" as const,
      sourceSection: "Workstreams" as const,
      workstreamIndex: index + 1,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      acceptanceCriteria,
      openQuestions,
      humanGates,
      providerRoleAssignments: blueprint.providerRoleAssignments,
      githubIssueDraft: resolveProjectWorkItemIssueDraft({
        blueprintTitle: blueprint.title,
        blueprintGoal: blueprint.goalSummary,
        blueprintRevisionId: blueprint.revisionId,
        workItemId: id,
        workItem: workstream,
        executionMode,
        acceptanceCriteria,
        openQuestions,
        humanGates,
        providerRoleAssignments: blueprint.providerRoleAssignments,
      }),
    };
  });

  const blockerList = [...blockers].toSorted();
  const suggestionList = [...suggestions].toSorted();
  return {
    repoRoot,
    inventoryPath,
    exists: false,
    schemaVersion: PROJECT_WORK_ITEM_SCHEMA_VERSION,
    generatedAt,
    blueprintExists: true,
    blueprintPath: blueprint.blueprintPath,
    blueprintTitle: blueprint.title,
    blueprintStatus: blueprint.status,
    blueprintRevisionId: blueprint.revisionId,
    currentBlueprintRevisionId: blueprint.revisionId,
    artifactStale: false,
    readyForExecution: blockerList.length === 0 && workItems.length > 0,
    readyForIssueProjection: blockerList.length === 0 && workItems.length > 0,
    blockerCount: blockerList.length,
    blockers: blockerList,
    suggestionCount: suggestionList.length,
    suggestions: suggestionList,
    workItemCount: workItems.length,
    plannedWorkItemCount: workItems.filter((item) => item.kind === "planned").length,
    discoveredWorkItemCount: workItems.filter((item) => item.kind === "discovered").length,
    workItems,
  };
}

export async function writeProjectWorkItemInventory(
  repoRootInput: string,
): Promise<ProjectWorkItemInventory> {
  const inventory = await deriveProjectWorkItemInventory(repoRootInput);
  if (!inventory.blueprintExists) {
    return inventory;
  }

  await mkdir(path.dirname(inventory.inventoryPath), { recursive: true });
  const persisted = {
    ...inventory,
    exists: true,
  };
  await writeFile(inventory.inventoryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectWorkItemInventory(
  repoRootInput: string,
): Promise<ProjectWorkItemInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectWorkItemInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);

  try {
    const raw = await readFile(inventoryPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectWorkItemInventory;
    return {
      ...parsed,
      inventoryPath,
      repoRoot,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintTitle: blueprint.title,
      blueprintStatus: blueprint.status,
      currentBlueprintRevisionId: blueprint.revisionId,
      artifactStale:
        blueprint.revisionId == null || parsed.blueprintRevisionId == null
          ? null
          : blueprint.revisionId !== parsed.blueprintRevisionId,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectWorkItemInventory({
        repoRoot,
        inventoryPath,
        blueprintPath: blueprint.blueprintPath,
        blueprintExists: blueprint.exists,
        blueprintTitle: blueprint.title,
        blueprintStatus: blueprint.status,
        blueprintRevisionId: blueprint.revisionId,
        currentBlueprintRevisionId: blueprint.revisionId,
      });
    }
    throw error;
  }
}
