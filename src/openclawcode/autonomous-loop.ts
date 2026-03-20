import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RepoRef } from "./github/index.js";
import type { OpenClawCodeOperatorStatusSnapshot } from "./operator-status.js";
import {
  writeProjectIssueMaterializationArtifact,
} from "./issue-materialization.js";
import { writeProjectProgressArtifact } from "./project-progress.js";

export const PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION = 1;

export interface ProjectAutonomousLoopArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  repoKey: string | null;
  enabled: boolean;
  mode: "once" | "off" | "status";
  status:
    | "disabled"
    | "blocked"
    | "missing-repo"
    | "materialized-only"
    | "materialized-and-queued";
  stopReason: string | null;
  nextWorkDecision: string;
  nextWorkBlockingGateId: string | null;
  nextWorkPrimaryBlocker: string | null;
  selectedWorkItemId: string | null;
  selectedWorkItemExecutionMode: string | null;
  selectedIssueNumber: number | null;
  selectedIssueUrl: string | null;
  queuedIssueKey: string | null;
  providerPauseActive: boolean;
  currentRunPresent: boolean;
  message: string | null;
}

function resolveProjectAutonomousLoopArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "autonomous-loop.json");
}

export async function setProjectAutonomousLoopDisabled(params: {
  repoRoot: string;
  repo?: RepoRef;
}): Promise<ProjectAutonomousLoopArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectAutonomousLoopArtifactPath(repoRoot);
  const artifact: ProjectAutonomousLoopArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
    enabled: false,
    mode: "off",
    status: "disabled",
    stopReason: "Autonomous loop is disabled until it is started again.",
    nextWorkDecision: "no-actionable-work-item",
    nextWorkBlockingGateId: null,
    nextWorkPrimaryBlocker: null,
    selectedWorkItemId: null,
    selectedWorkItemExecutionMode: null,
    selectedIssueNumber: null,
    selectedIssueUrl: null,
    queuedIssueKey: null,
    providerPauseActive: false,
    currentRunPresent: false,
    message: "Autonomous loop disabled.",
  };
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectAutonomousLoopArtifact(
  repoRootInput: string,
): Promise<ProjectAutonomousLoopArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectAutonomousLoopArtifactPath(repoRoot);
  const raw = await readFile(artifactPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!raw) {
    return {
      repoRoot,
      artifactPath,
      exists: false,
      schemaVersion: null,
      generatedAt: null,
      repoKey: null,
      enabled: false,
      mode: "status",
      status: "disabled",
      stopReason: null,
      nextWorkDecision: "no-actionable-work-item",
      nextWorkBlockingGateId: null,
      nextWorkPrimaryBlocker: null,
      selectedWorkItemId: null,
      selectedWorkItemExecutionMode: null,
      selectedIssueNumber: null,
      selectedIssueUrl: null,
      queuedIssueKey: null,
      providerPauseActive: false,
      currentRunPresent: false,
      message: null,
    };
  }
  return JSON.parse(raw) as ProjectAutonomousLoopArtifact;
}

export async function runProjectAutonomousLoopOnce(params: {
  repoRoot: string;
  repo?: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
  queueIssue?: (args: { issueNumber: number }) => Promise<{ queued: boolean; issueKey: string | null }>;
}): Promise<ProjectAutonomousLoopArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectAutonomousLoopArtifactPath(repoRoot);
  const progress = await writeProjectProgressArtifact({
    repoRoot,
    repo: params.repo,
    operatorSnapshot: params.operatorSnapshot,
  });
  const currentRunPresent = progress.operator.currentRunCount > 0;
  const providerPauseActive = progress.operator.providerPauseActive;

  let status: ProjectAutonomousLoopArtifact["status"] = "blocked";
  let stopReason: string | null = null;
  let queuedIssueKey: string | null = null;
  let message: string | null = null;

  if (!params.repo) {
    status = "missing-repo";
    stopReason = "Resolve the GitHub owner/repo before autonomous issue materialization can continue.";
  } else if (providerPauseActive) {
    stopReason = "Provider pause is active.";
  } else if (currentRunPresent) {
    stopReason = "A run is already active for this repository.";
  } else if (progress.nextWorkDecision !== "ready-to-execute") {
    stopReason = `Autonomous progress is blocked at ${progress.nextWorkDecision}.`;
  } else {
    const issueMaterialization = await writeProjectIssueMaterializationArtifact({
      repoRoot,
      owner: params.repo.owner,
      repo: params.repo.repo,
    });
    if (params.queueIssue && issueMaterialization.selectedIssueNumber != null) {
      const queued = await params.queueIssue({
        issueNumber: issueMaterialization.selectedIssueNumber,
      });
      status = queued.queued ? "materialized-and-queued" : "materialized-only";
      queuedIssueKey = queued.issueKey;
      message = queued.queued
        ? `Queued ${queued.issueKey} after issue materialization.`
        : "Materialized the next issue, but left queue state unchanged.";
    } else {
      status = "materialized-only";
      message = "Materialized the next issue.";
    }
    const artifact: ProjectAutonomousLoopArtifact = {
      repoRoot,
      artifactPath,
      exists: true,
      schemaVersion: PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      repoKey: `${params.repo.owner}/${params.repo.repo}`,
      enabled: true,
      mode: "once",
      status,
      stopReason,
      nextWorkDecision: progress.nextWorkDecision,
      nextWorkBlockingGateId: progress.nextWorkBlockingGateId,
      nextWorkPrimaryBlocker: progress.nextWorkPrimaryBlocker,
      selectedWorkItemId: issueMaterialization.selectedWorkItemId,
      selectedWorkItemExecutionMode: issueMaterialization.selectedWorkItemExecutionMode,
      selectedIssueNumber: issueMaterialization.selectedIssueNumber,
      selectedIssueUrl: issueMaterialization.selectedIssueUrl,
      queuedIssueKey,
      providerPauseActive,
      currentRunPresent,
      message,
    };
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return artifact;
  }

  const artifact: ProjectAutonomousLoopArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
    enabled: true,
    mode: "once",
    status,
    stopReason,
    nextWorkDecision: progress.nextWorkDecision,
    nextWorkBlockingGateId: progress.nextWorkBlockingGateId,
    nextWorkPrimaryBlocker: progress.nextWorkPrimaryBlocker,
    selectedWorkItemId: progress.selectedWorkItemId,
    selectedWorkItemExecutionMode: progress.selectedWorkItemExecutionMode,
    selectedIssueNumber: progress.selectedIssueNumber,
    selectedIssueUrl: progress.selectedIssueUrl,
    queuedIssueKey,
    providerPauseActive,
    currentRunPresent,
    message,
  };
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}
