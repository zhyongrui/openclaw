import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readProjectBlueprintDocument } from "./blueprint.js";
import {
  readProjectIssueMaterializationArtifact,
  writeProjectIssueMaterializationArtifact,
} from "./issue-materialization.js";
import type { RepoRef } from "./github/index.js";
import type { OpenClawCodeOperatorStatusSnapshot } from "./operator-status.js";
import { readProjectNextWorkSelection, writeProjectNextWorkSelection } from "./next-work.js";
import { readProjectRoleRoutingPlan, writeProjectRoleRoutingPlan } from "./role-routing.js";
import { readProjectStageGateArtifact, writeProjectStageGateArtifact } from "./stage-gates.js";
import { readProjectWorkItemInventory, writeProjectWorkItemInventory } from "./work-items.js";

export const PROJECT_PROGRESS_SCHEMA_VERSION = 1;

export interface ProjectProgressOperatorSummary {
  available: boolean;
  repoKey: string | null;
  bindingPresent: boolean;
  pendingApprovalCount: number;
  queuedRunCount: number;
  currentRunCount: number;
  currentRunIssueKey: string | null;
  currentRunStage: string | null;
  currentRunBranchName: string | null;
  currentRunPullRequestNumber: number | null;
  currentRunPullRequestUrl: string | null;
  currentRunStatusUpdatedAt: string | null;
  providerPauseActive: boolean;
}

export interface ProjectProgressArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  repoKey: string | null;
  blueprintPath: string;
  blueprintStatus: string | null;
  blueprintRevisionId: string | null;
  workItemCount: number;
  plannedWorkItemCount: number;
  nextWorkDecision: string;
  nextWorkBlockingGateId: string | null;
  nextWorkPrimaryBlocker: string | null;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  selectedWorkItemExecutionMode: string | null;
  selectedIssueNumber: number | null;
  selectedIssueUrl: string | null;
  selectedIssueTitle: string | null;
  issueMaterializationOutcome: string | null;
  roleRoutingMixedMode: boolean;
  roleRouteSummary: string[];
  unresolvedRoleCount: number;
  blockedGateCount: number;
  needsHumanDecisionCount: number;
  nextSuggestedCommand: string | null;
  operator: ProjectProgressOperatorSummary;
}

function resolveProjectProgressArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "project-progress.json");
}

function buildOperatorSummary(params: {
  repo?: RepoRef;
  snapshot?: OpenClawCodeOperatorStatusSnapshot;
}): ProjectProgressOperatorSummary {
  if (!params.repo || !params.snapshot) {
    return {
      available: false,
      repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
      bindingPresent: false,
      pendingApprovalCount: 0,
      queuedRunCount: 0,
      currentRunCount: 0,
      currentRunIssueKey: null,
      currentRunStage: null,
      currentRunBranchName: null,
      currentRunPullRequestNumber: null,
      currentRunPullRequestUrl: null,
      currentRunStatusUpdatedAt: null,
      providerPauseActive: false,
    };
  }

  const repoKey = `${params.repo.owner}/${params.repo.repo}`;
  const repoSummary = params.snapshot.repos.find((entry) => entry.repoKey === repoKey);
  const currentRunIssueKey =
    params.snapshot.currentRun &&
    params.snapshot.currentRun.request.owner === params.repo.owner &&
    params.snapshot.currentRun.request.repo === params.repo.repo
      ? `${params.snapshot.currentRun.request.owner}/${params.snapshot.currentRun.request.repo}#${params.snapshot.currentRun.request.issueNumber}`
      : null;
  const currentRunSnapshot = currentRunIssueKey
    ? params.snapshot.issueSnapshots.find((entry) => entry.issueKey === currentRunIssueKey) ?? null
    : null;

  return {
    available: true,
    repoKey,
    bindingPresent: Boolean(repoSummary?.bindingPresent),
    pendingApprovalCount: repoSummary?.pendingApprovalCount ?? 0,
    queuedRunCount: repoSummary?.queuedRunCount ?? 0,
    currentRunCount: repoSummary?.currentRunCount ?? 0,
    currentRunIssueKey,
    currentRunStage: currentRunSnapshot?.stage ?? null,
    currentRunBranchName:
      currentRunSnapshot?.branchName ?? params.snapshot.currentRun?.request.branchName ?? null,
    currentRunPullRequestNumber: currentRunSnapshot?.pullRequestNumber ?? null,
    currentRunPullRequestUrl: currentRunSnapshot?.pullRequestUrl ?? null,
    currentRunStatusUpdatedAt: currentRunSnapshot?.updatedAt ?? null,
    providerPauseActive: params.snapshot.providerPauseActive,
  };
}

export async function writeProjectProgressArtifact(params: {
  repoRoot: string;
  repo?: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
  materializeIssues?: boolean;
}): Promise<ProjectProgressArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectProgressArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const workItems = await writeProjectWorkItemInventory(repoRoot);
  const nextWork = await writeProjectNextWorkSelection(repoRoot);
  const roleRouting = await writeProjectRoleRoutingPlan(repoRoot);
  const stageGates = await writeProjectStageGateArtifact(repoRoot);
  const issueMaterialization =
    params.materializeIssues && params.repo
      ? await writeProjectIssueMaterializationArtifact({
          repoRoot,
          owner: params.repo.owner,
          repo: params.repo.repo,
        })
      : await readProjectIssueMaterializationArtifact(repoRoot);
  const roleRouteSummary = roleRouting.routes.map((route) => {
    const roleLabel = route.roleId === "docWriter" ? "doc-writer" : route.roleId;
    return `${roleLabel}=${route.resolvedBackend}${route.resolvedAgentId ? `@${route.resolvedAgentId}` : ""}`;
  });

  const nextSuggestedCommand = nextWork.decision === "ready-to-execute"
    ? params.repo
      ? `openclaw code issue-materialize --repo-root ${repoRoot}`
      : "openclaw code issue-materialize --repo-root <repo-root>"
    : nextWork.blockingGateId
      ? `openclaw code stage-gates-show --repo-root ${repoRoot}`
      : null;

  const artifact: ProjectProgressArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_PROGRESS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
    blueprintPath: blueprint.blueprintPath,
    blueprintStatus: blueprint.status,
    blueprintRevisionId: blueprint.revisionId,
    workItemCount: workItems.workItemCount,
    plannedWorkItemCount: workItems.plannedWorkItemCount,
    nextWorkDecision: nextWork.decision,
    nextWorkBlockingGateId: nextWork.blockingGateId,
    nextWorkPrimaryBlocker: nextWork.blockers[0] ?? null,
    selectedWorkItemId: nextWork.selectedWorkItem?.id ?? null,
    selectedWorkItemTitle: nextWork.selectedWorkItem?.title ?? null,
    selectedWorkItemExecutionMode: nextWork.selectedWorkItem?.executionMode ?? null,
    selectedIssueNumber: issueMaterialization.selectedIssueNumber,
    selectedIssueUrl: issueMaterialization.selectedIssueUrl,
    selectedIssueTitle: issueMaterialization.selectedIssueTitle,
    issueMaterializationOutcome: issueMaterialization.outcome,
    roleRoutingMixedMode: roleRouting.mixedMode,
    roleRouteSummary,
    unresolvedRoleCount: roleRouting.unresolvedRoleCount,
    blockedGateCount: stageGates.blockedGateCount,
    needsHumanDecisionCount: stageGates.needsHumanDecisionCount,
    nextSuggestedCommand,
    operator: buildOperatorSummary({
      repo: params.repo,
      snapshot: params.operatorSnapshot,
    }),
  };

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectProgressArtifact(
  repoRootInput: string,
): Promise<ProjectProgressArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectProgressArtifactPath(repoRoot);
  const raw = await readFile(artifactPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!raw) {
    const blueprint = await readProjectBlueprintDocument(repoRoot);
    return {
      repoRoot,
      artifactPath,
      exists: false,
      schemaVersion: null,
      generatedAt: null,
      repoKey: null,
      blueprintPath: blueprint.blueprintPath,
      blueprintStatus: blueprint.status,
      blueprintRevisionId: blueprint.revisionId,
      workItemCount: 0,
      plannedWorkItemCount: 0,
      nextWorkDecision: "no-actionable-work-item",
      nextWorkBlockingGateId: null,
      nextWorkPrimaryBlocker: null,
      selectedWorkItemId: null,
      selectedWorkItemTitle: null,
      selectedWorkItemExecutionMode: null,
      selectedIssueNumber: null,
      selectedIssueUrl: null,
      selectedIssueTitle: null,
      issueMaterializationOutcome: null,
      roleRoutingMixedMode: false,
      roleRouteSummary: [],
      unresolvedRoleCount: 0,
      blockedGateCount: 0,
      needsHumanDecisionCount: 0,
      nextSuggestedCommand: null,
      operator: buildOperatorSummary({}),
    };
  }
  return JSON.parse(raw) as ProjectProgressArtifact;
}
