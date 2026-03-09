import type { WorkflowRun } from "../contracts/index.js";

export type IssueImplementationScope = "command-layer" | "workflow-core" | "mixed";

export interface ScopeGuardrail {
  classification: IssueImplementationScope;
  preferredPaths: string[];
  blockedPaths: string[];
  notes: string[];
}

export interface ScopeCheckResult {
  ok: boolean;
  classification: IssueImplementationScope;
  blockedFiles: string[];
  summary: string;
}

const COMMAND_LAYER_HINTS = [
  "openclaw code run",
  "--json",
  "cli",
  "command",
  "stdout",
  "output",
  "flag",
];

const WORKFLOW_CORE_HINTS = [
  "workflow",
  "orchestrator",
  "persistence",
  "resume",
  "retry",
  "state machine",
  "verification",
  "planner",
  "builder",
  "verifier",
  "draft pr",
  "pull request",
  "run record",
  "artifact",
];

const COMMAND_LAYER_PREFERRED_PATHS = [
  "src/commands/openclawcode.ts",
  "src/commands/openclawcode.test.ts",
  "docs/openclawcode/",
];

const COMMAND_LAYER_BLOCKED_PATHS = [
  "src/openclawcode/contracts/",
  "src/openclawcode/orchestrator/",
  "src/openclawcode/persistence/",
  "src/openclawcode/workflow/",
];

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function matchesPathRule(file: string, rule: string): boolean {
  const normalizedFile = normalizePath(file);
  const normalizedRule = normalizePath(rule);
  if (normalizedRule.endsWith("/")) {
    return normalizedFile.startsWith(normalizedRule);
  }
  return normalizedFile === normalizedRule;
}

function countHints(text: string, hints: string[]): number {
  return hints.reduce((total, hint) => (text.includes(hint) ? total + 1 : total), 0);
}

function collectSupportText(run: WorkflowRun): string {
  return [
    run.executionSpec?.summary ?? "",
    ...(run.executionSpec?.scope ?? []),
    ...(run.executionSpec?.acceptanceCriteria.map((entry) => entry.text) ?? []),
    ...(run.executionSpec?.testPlan ?? []),
  ]
    .join("\n")
    .toLowerCase();
}

export function classifyIssueScope(run: WorkflowRun): IssueImplementationScope {
  const issueText = [run.issue.title, run.issue.body ?? ""].join("\n").toLowerCase();
  const issueCommandScore = countHints(issueText, COMMAND_LAYER_HINTS);
  const issueWorkflowScore = countHints(issueText, WORKFLOW_CORE_HINTS);

  if (issueCommandScore > 0 && issueWorkflowScore === 0) {
    return "command-layer";
  }
  if (issueWorkflowScore > 0 && issueCommandScore === 0) {
    return "workflow-core";
  }
  if (issueCommandScore > 0 && issueWorkflowScore > 0) {
    return "mixed";
  }

  const supportText = collectSupportText(run);
  const supportCommandScore = countHints(supportText, COMMAND_LAYER_HINTS);
  const supportWorkflowScore = countHints(supportText, WORKFLOW_CORE_HINTS);

  if (supportCommandScore > 0 && supportWorkflowScore === 0) {
    return "command-layer";
  }
  if (supportWorkflowScore > 0 && supportCommandScore === 0) {
    return "workflow-core";
  }
  if (supportCommandScore > 0 && supportWorkflowScore > 0) {
    return "mixed";
  }

  return "mixed";
}

export function buildScopeGuardrail(run: WorkflowRun): ScopeGuardrail {
  const classification = classifyIssueScope(run);

  if (classification === "command-layer") {
    return {
      classification,
      preferredPaths: [...COMMAND_LAYER_PREFERRED_PATHS],
      blockedPaths: [...COMMAND_LAYER_BLOCKED_PATHS],
      notes: [
        "This issue appears command-layer focused. Prefer the smallest fix in src/commands/openclawcode.ts and its tests first.",
        "If the requested behavior can be derived from existing workflow state, do that instead of changing workflow contracts or persistence.",
        "Do not edit workflow-core modules unless the issue explicitly requires new persisted data or orchestration behavior.",
      ],
    };
  }

  if (classification === "workflow-core") {
    return {
      classification,
      preferredPaths: [
        "src/openclawcode/app/run-issue.ts",
        "src/openclawcode/contracts/types.ts",
        "src/openclawcode/orchestrator/run.ts",
        "src/openclawcode/testing/run-issue.test.ts",
        "src/openclawcode/testing/orchestrator.test.ts",
      ],
      blockedPaths: [],
      notes: [
        "This issue appears workflow-core focused. Prefer targeted workflow modules and tests.",
      ],
    };
  }

  return {
    classification,
    preferredPaths: [
      ...COMMAND_LAYER_PREFERRED_PATHS,
      "src/openclawcode/app/run-issue.ts",
      "src/openclawcode/contracts/types.ts",
      "src/openclawcode/orchestrator/run.ts",
      "src/openclawcode/testing/run-issue.test.ts",
      "src/openclawcode/testing/orchestrator.test.ts",
    ],
    blockedPaths: [],
    notes: [
      "This issue appears mixed. Keep the change set explicit, targeted, and aligned with the issue text.",
    ],
  };
}

export function checkBuildScope(run: WorkflowRun, changedFiles: string[]): ScopeCheckResult {
  const guardrail = buildScopeGuardrail(run);
  const blockedFiles = changedFiles
    .map((entry) => normalizePath(entry))
    .filter((entry) => guardrail.blockedPaths.some((rule) => matchesPathRule(entry, rule)));

  if (guardrail.classification === "command-layer" && blockedFiles.length > 0) {
    return {
      ok: false,
      classification: guardrail.classification,
      blockedFiles,
      summary: [
        "Command-layer issue drifted into workflow-core files.",
        `Blocked files: ${blockedFiles.join(", ")}`,
        "Retry with a smaller command-layer change unless the issue explicitly requires workflow-core changes.",
      ].join(" "),
    };
  }

  return {
    ok: true,
    classification: guardrail.classification,
    blockedFiles: [],
    summary: `Scope check passed for ${guardrail.classification} issue.`,
  };
}
