import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectProjectBlueprintClarifications,
  readProjectBlueprintDocument,
  type ProjectBlueprintRoleAssignments,
} from "./blueprint.js";
import { readProjectWorkItemInventory, type ProjectWorkItem } from "./work-items.js";

export const PROJECT_DISCOVERY_SCHEMA_VERSION = 1;
export const PROJECT_DISCOVERY_SEVERITIES = ["low", "medium", "high"] as const;
export const PROJECT_DISCOVERY_PRIORITIES = ["low", "medium", "high"] as const;

export type ProjectDiscoverySeverity = (typeof PROJECT_DISCOVERY_SEVERITIES)[number];
export type ProjectDiscoveryPriority = (typeof PROJECT_DISCOVERY_PRIORITIES)[number];

export interface ProjectDiscoveryEvidence {
  id: string;
  dedupeKey: string;
  source: "blueprint-open-questions" | "work-item-artifact-missing" | "work-item-artifact-stale";
  severity: ProjectDiscoverySeverity;
  priority: ProjectDiscoveryPriority;
  summary: string;
  detail: string;
  discoveredWorkItem: ProjectWorkItem;
}

export interface ProjectDiscoveryInventory {
  repoRoot: string;
  inventoryPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  workItemInventoryExists: boolean;
  workItemInventoryPath: string;
  workItemArtifactStale: boolean | null;
  evidenceCount: number;
  blockerCount: number;
  blockers: string[];
  discoveredWorkItemCount: number;
  highestPriority: ProjectDiscoveryPriority | null;
  evidence: ProjectDiscoveryEvidence[];
}

function resolveProjectDiscoveryInventoryPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "discovery-work-items.json");
}

function compareDiscoveryPriority(
  left: ProjectDiscoveryPriority,
  right: ProjectDiscoveryPriority,
): number {
  const order: ProjectDiscoveryPriority[] = ["low", "medium", "high"];
  return order.indexOf(left) - order.indexOf(right);
}

function highestDiscoveryPriority(
  priorities: ProjectDiscoveryPriority[],
): ProjectDiscoveryPriority | null {
  if (priorities.length === 0) {
    return null;
  }
  return [...priorities].toSorted(compareDiscoveryPriority).at(-1) ?? null;
}

function discoveredIssueDraft(params: {
  title: string;
  summary: string;
  detail: string;
  severity: ProjectDiscoverySeverity;
  priority: ProjectDiscoveryPriority;
  dedupeKey: string;
}): { title: string; body: string } {
  return {
    title: `[Discovery]: ${params.title}`,
    body: [
      "Summary",
      params.summary,
      "",
      "Evidence",
      `- Severity: ${params.severity}`,
      `- Priority: ${params.priority}`,
      `- Dedupe key: ${params.dedupeKey}`,
      `- Detail: ${params.detail}`,
      "",
      "Proposed next step",
      "- Convert this discovered work item into an operator-reviewed execution issue or refresh the repo-local artifacts directly.",
    ].join("\n"),
  };
}

function makeDiscoveredWorkItem(params: {
  id: string;
  title: string;
  summary: string;
  source: ProjectDiscoveryEvidence["source"];
  blueprintPath: string;
  blueprintRevisionId: string | null;
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
  detail: string;
  severity: ProjectDiscoverySeverity;
  priority: ProjectDiscoveryPriority;
  dedupeKey: string;
}): ProjectWorkItem {
  const executionMode =
    params.source === "blueprint-open-questions"
      ? "research"
      : "feature";
  const workItemClass =
    params.source === "work-item-artifact-missing" || params.source === "work-item-artifact-stale"
      ? "sync"
      : "feature";
  return {
    id: params.id,
    kind: "discovered",
    status: "planned",
    class: workItemClass,
    executionMode,
    fingerprint: params.dedupeKey,
    title: params.title,
    summary: params.summary,
    source: "blueprint",
    sourceSection: "Workstreams",
    workstreamIndex: 0,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    acceptanceCriteria: [
      "Capture the underlying evidence in a stable artifact or issue body.",
      "Leave the repository in a state where the discovered condition is no longer true.",
    ],
    openQuestions: [],
    humanGates: ["Operator may review discovered work items before issue projection."],
    providerRoleAssignments: params.providerRoleAssignments,
    githubIssueDraft: discoveredIssueDraft({
      title: params.title,
      summary: params.summary,
      detail: params.detail,
      severity: params.severity,
      priority: params.priority,
      dedupeKey: params.dedupeKey,
    }),
    githubIssue: {
      current: null,
      history: [],
    },
  };
}

function emptyProjectDiscoveryInventory(params: {
  repoRoot: string;
  inventoryPath: string;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  workItemInventoryExists: boolean;
  workItemInventoryPath: string;
  workItemArtifactStale: boolean | null;
}): ProjectDiscoveryInventory {
  return {
    repoRoot: params.repoRoot,
    inventoryPath: params.inventoryPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    workItemInventoryExists: params.workItemInventoryExists,
    workItemInventoryPath: params.workItemInventoryPath,
    workItemArtifactStale: params.workItemArtifactStale,
    evidenceCount: 0,
    blockerCount: 0,
    blockers: [],
    discoveredWorkItemCount: 0,
    highestPriority: null,
    evidence: [],
  };
}

export async function deriveProjectDiscoveryInventory(
  repoRootInput: string,
): Promise<ProjectDiscoveryInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectDiscoveryInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const clarification = await inspectProjectBlueprintClarifications(repoRoot);
  const workItems = await readProjectWorkItemInventory(repoRoot);
  const blockers = [...clarification.questions].toSorted();

  if (!blueprint.exists) {
    return {
      ...emptyProjectDiscoveryInventory({
        repoRoot,
        inventoryPath,
        blueprintExists: false,
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: null,
        workItemInventoryExists: workItems.exists,
        workItemInventoryPath: workItems.inventoryPath,
        workItemArtifactStale: workItems.artifactStale,
      }),
      blockerCount: blockers.length,
      blockers,
    };
  }

  const evidence: ProjectDiscoveryEvidence[] = [];

  if (blueprint.hasAgreementCheckpoint && !workItems.exists) {
    const dedupeKey = `work-item-artifact-missing:${blueprint.revisionId ?? "none"}`;
    evidence.push({
      id: "discovery-work-item-artifact-missing",
      dedupeKey,
      source: "work-item-artifact-missing",
      severity: "high",
      priority: "high",
      summary: "Generate the repo-local work-item inventory for the agreed blueprint.",
      detail:
        "The blueprint is already agreed, but `.openclawcode/work-items.json` does not exist yet.",
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-refresh-missing-work-item-artifact",
        title: "Generate the repo-local work-item inventory for the agreed blueprint.",
        summary: "Create `.openclawcode/work-items.json` from the current agreed blueprint.",
        source: "work-item-artifact-missing",
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        providerRoleAssignments: blueprint.providerRoleAssignments,
        detail:
          "The blueprint is already agreed, but `.openclawcode/work-items.json` does not exist yet.",
        severity: "high",
        priority: "high",
        dedupeKey,
      }),
    });
  }

  if (workItems.exists && workItems.artifactStale) {
    const dedupeKey = `work-item-artifact-stale:${blueprint.revisionId ?? "none"}`;
    evidence.push({
      id: "discovery-work-item-artifact-stale",
      dedupeKey,
      source: "work-item-artifact-stale",
      severity: "medium",
      priority: "high",
      summary: "Refresh the repo-local work-item inventory after blueprint changes.",
      detail:
        "The current `PROJECT-BLUEPRINT.md` revision no longer matches the persisted work-item artifact.",
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-refresh-stale-work-item-artifact",
        title: "Refresh the repo-local work-item inventory after blueprint changes.",
        summary:
          "Regenerate `.openclawcode/work-items.json` so the persisted backlog matches the current blueprint revision.",
        source: "work-item-artifact-stale",
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        providerRoleAssignments: blueprint.providerRoleAssignments,
        detail:
          "The current `PROJECT-BLUEPRINT.md` revision no longer matches the persisted work-item artifact.",
        severity: "medium",
        priority: "high",
        dedupeKey,
      }),
    });
  }

  if (blueprint.openQuestionCount > 0) {
    const dedupeKey = `blueprint-open-questions:${blueprint.revisionId ?? "none"}:${blueprint.openQuestionCount}`;
    evidence.push({
      id: "discovery-blueprint-open-questions",
      dedupeKey,
      source: "blueprint-open-questions",
      severity: "medium",
      priority: "medium",
      summary: "Resolve the remaining blueprint open questions before autonomous execution.",
      detail:
        "The blueprint still records unresolved items under `Open Questions`, so the operator should close or explicitly accept them.",
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-resolve-blueprint-open-questions",
        title: "Resolve the remaining blueprint open questions before autonomous execution.",
        summary:
          "Review the `Open Questions` section in `PROJECT-BLUEPRINT.md` and resolve, clear, or explicitly accept each item.",
        source: "blueprint-open-questions",
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        providerRoleAssignments: blueprint.providerRoleAssignments,
        detail:
          "The blueprint still records unresolved items under `Open Questions`, so the operator should close or explicitly accept them.",
        severity: "medium",
        priority: "medium",
        dedupeKey,
      }),
    });
  }

  return {
    repoRoot,
    inventoryPath,
    exists: false,
    schemaVersion: PROJECT_DISCOVERY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    blueprintExists: true,
    blueprintPath: blueprint.blueprintPath,
    blueprintRevisionId: blueprint.revisionId,
    workItemInventoryExists: workItems.exists,
    workItemInventoryPath: workItems.inventoryPath,
    workItemArtifactStale: workItems.artifactStale,
    evidenceCount: evidence.length,
    blockerCount: blockers.length,
    blockers,
    discoveredWorkItemCount: evidence.length,
    highestPriority: highestDiscoveryPriority(evidence.map((item) => item.priority)),
    evidence,
  };
}

export async function writeProjectDiscoveryInventory(
  repoRootInput: string,
): Promise<ProjectDiscoveryInventory> {
  const inventory = await deriveProjectDiscoveryInventory(repoRootInput);
  await mkdir(path.dirname(inventory.inventoryPath), { recursive: true });
  const persisted = {
    ...inventory,
    exists: true,
  };
  await writeFile(inventory.inventoryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectDiscoveryInventory(
  repoRootInput: string,
): Promise<ProjectDiscoveryInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectDiscoveryInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const workItems = await readProjectWorkItemInventory(repoRoot);

  try {
    const raw = await readFile(inventoryPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectDiscoveryInventory;
    return {
      ...parsed,
      repoRoot,
      inventoryPath,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      workItemInventoryExists: workItems.exists,
      workItemInventoryPath: workItems.inventoryPath,
      workItemArtifactStale: workItems.artifactStale,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectDiscoveryInventory({
        repoRoot,
        inventoryPath,
        blueprintExists: blueprint.exists,
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        workItemInventoryExists: workItems.exists,
        workItemInventoryPath: workItems.inventoryPath,
        workItemArtifactStale: workItems.artifactStale,
      });
    }
    throw error;
  }
}
