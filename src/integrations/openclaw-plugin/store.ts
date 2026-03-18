import fs from "node:fs/promises";
import path from "node:path";
import type {
  WorkflowFailureDiagnostics,
  SuitabilityDecision,
  WorkflowRun,
  WorkflowStage,
} from "../../openclawcode/contracts/index.js";
import { resolveAutoMergeDisposition, resolveAutoMergePolicy } from "../../openclawcode/index.js";
import type { OpenClawCodeScopedIssueDraft } from "./chatops.js";
import type { OpenClawCodeChatopsRunRequest } from "./chatops.js";

export interface OpenClawCodeQueuedRun {
  request: OpenClawCodeChatopsRunRequest;
  notifyChannel: string;
  notifyTarget: string;
  issueKey: string;
}

export type OpenClawCodePendingApprovalKind = "manual" | "execution-start-gated";

export interface OpenClawCodePendingApproval {
  issueKey: string;
  notifyChannel: string;
  notifyTarget: string;
  approvalKind?: OpenClawCodePendingApprovalKind;
}

export interface OpenClawCodePendingIntakeDraft {
  repoKey: string;
  notifyChannel: string;
  notifyTarget: string;
  title: string;
  body: string;
  sourceRequest: string;
  bodySynthesized: boolean;
  scopedDrafts: OpenClawCodeScopedIssueDraft[];
  clarificationQuestions: string[];
  clarificationSuggestions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenClawCodeManualTakeover {
  issueKey: string;
  runId: string;
  stage: WorkflowStage;
  branchName?: string;
  worktreePath: string;
  notifyChannel: string;
  notifyTarget: string;
  actor?: string;
  note?: string;
  requestedAt: string;
}

export interface OpenClawCodeDeferredRuntimeReroute {
  issueKey: string;
  notifyChannel: string;
  notifyTarget: string;
  requestedAt: string;
  actor?: string;
  note?: string;
  sourceRunId?: string;
  sourceStage?: WorkflowStage;
  requestedCoderAgentId?: string;
  requestedVerifierAgentId?: string;
}

export interface OpenClawCodeIssueStatusSnapshot {
  issueKey: string;
  status: string;
  stage: WorkflowStage;
  runId: string;
  updatedAt: string;
  owner: string;
  repo: string;
  issueNumber: number;
  branchName?: string;
  worktreePath?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  notifyChannel?: string;
  notifyTarget?: string;
  latestReviewDecision?: "approved" | "changes-requested";
  latestReviewSubmittedAt?: string;
  latestReviewSummary?: string;
  latestReviewUrl?: string;
  rerunReason?: string;
  rerunRequestedAt?: string;
  rerunPriorRunId?: string;
  rerunPriorStage?: WorkflowStage;
  rerunRequestedCoderAgentId?: string;
  rerunRequestedVerifierAgentId?: string;
  suitabilityDecision?: SuitabilityDecision;
  suitabilitySummary?: string;
  suitabilityAllowlisted?: boolean;
  suitabilityDenylisted?: boolean;
  suitabilityOverrideApplied?: boolean;
  suitabilityOverrideActor?: string;
  suitabilityOverrideReason?: string;
  autoMergePolicyEligible?: boolean;
  autoMergePolicyReason?: string;
  autoMergeDisposition?: "merged" | "skipped" | "failed";
  autoMergeDispositionReason?: string;
  failureDiagnostics?: WorkflowFailureDiagnostics;
  providerFailureCount?: number;
  lastProviderFailureAt?: string;
  providerPauseUntil?: string;
  providerPauseReason?: string;
  lastNotificationChannel?: string;
  lastNotificationTarget?: string;
  lastNotificationAt?: string;
  lastNotificationStatus?: "sent" | "failed";
  lastNotificationError?: string;
}

export interface OpenClawCodeRepoNotificationBinding {
  repoKey: string;
  notifyChannel: string;
  notifyTarget: string;
  updatedAt: string;
}

export interface OpenClawCodeGitHubDeliveryRecord {
  deliveryId: string;
  eventName: string;
  action: string;
  accepted: boolean;
  reason: string;
  receivedAt: string;
  issueKey?: string;
  pullRequestNumber?: number;
}

export interface OpenClawCodeTransientProviderFailureRecord {
  issueKey: string;
  runId: string;
  failedAt: string;
  summary: string;
}

export interface OpenClawCodeProviderPause {
  until: string;
  triggeredAt: string;
  lastFailureAt: string;
  failureCount: number;
  reason: string;
}

export interface OpenClawCodeQueueState {
  version: 1;
  pendingApprovals: OpenClawCodePendingApproval[];
  pendingIntakeDrafts: OpenClawCodePendingIntakeDraft[];
  manualTakeovers: OpenClawCodeManualTakeover[];
  deferredRuntimeReroutes: OpenClawCodeDeferredRuntimeReroute[];
  queue: OpenClawCodeQueuedRun[];
  currentRun?: OpenClawCodeQueuedRun;
  statusByIssue: Record<string, string>;
  statusSnapshotsByIssue: Record<string, OpenClawCodeIssueStatusSnapshot>;
  repoBindingsByRepo: Record<string, OpenClawCodeRepoNotificationBinding>;
  githubDeliveriesById: Record<string, OpenClawCodeGitHubDeliveryRecord>;
  recentProviderFailures: OpenClawCodeTransientProviderFailureRecord[];
  providerPause?: OpenClawCodeProviderPause;
}

const MAX_GITHUB_DELIVERY_RECORDS = 200;
const PROVIDER_FAILURE_WINDOW_MS = 15 * 60_000;
const PROVIDER_PAUSE_MS = 10 * 60_000;
const PROVIDER_FAILURE_THRESHOLD = 2;
const PROVIDER_INTERNAL_ERROR_PATTERN = /HTTP 400:\s*Internal server error/i;

function cloneDefaultState(): OpenClawCodeQueueState {
  return {
    version: 1,
    pendingApprovals: [],
    pendingIntakeDrafts: [],
    manualTakeovers: [],
    deferredRuntimeReroutes: [],
    queue: [],
    statusByIssue: {},
    statusSnapshotsByIssue: {},
    repoBindingsByRepo: {},
    githubDeliveriesById: {},
    recentProviderFailures: [],
  };
}

function normalizePendingIntakeDraft(raw: unknown): OpenClawCodePendingIntakeDraft | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodePendingIntakeDraft>;
  if (
    typeof candidate.repoKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.body !== "string" ||
    typeof candidate.sourceRequest !== "string" ||
    typeof candidate.bodySynthesized !== "boolean" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    repoKey: candidate.repoKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    title: candidate.title,
    body: candidate.body,
    sourceRequest: candidate.sourceRequest,
    bodySynthesized: candidate.bodySynthesized,
    scopedDrafts: Array.isArray(candidate.scopedDrafts)
      ? candidate.scopedDrafts.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const candidateDraft = entry as Partial<OpenClawCodeScopedIssueDraft>;
          if (
            typeof candidateDraft.title !== "string" ||
            typeof candidateDraft.body !== "string" ||
            typeof candidateDraft.reason !== "string"
          ) {
            return [];
          }
          return [
            {
              title: candidateDraft.title,
              body: candidateDraft.body,
              reason: candidateDraft.reason,
            } satisfies OpenClawCodeScopedIssueDraft,
          ];
        })
      : [],
    clarificationQuestions: Array.isArray(candidate.clarificationQuestions)
      ? candidate.clarificationQuestions.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    clarificationSuggestions: Array.isArray(candidate.clarificationSuggestions)
      ? candidate.clarificationSuggestions.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function normalizeManualTakeover(raw: unknown): OpenClawCodeManualTakeover | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeManualTakeover>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.stage !== "string" ||
    typeof candidate.worktreePath !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.requestedAt !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    runId: candidate.runId,
    stage: candidate.stage,
    branchName: typeof candidate.branchName === "string" ? candidate.branchName : undefined,
    worktreePath: candidate.worktreePath,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    actor: typeof candidate.actor === "string" ? candidate.actor : undefined,
    note: typeof candidate.note === "string" ? candidate.note : undefined,
    requestedAt: candidate.requestedAt,
  };
}

function normalizeDeferredRuntimeReroute(
  raw: unknown,
): OpenClawCodeDeferredRuntimeReroute | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeDeferredRuntimeReroute>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.requestedAt !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    requestedAt: candidate.requestedAt,
    actor: typeof candidate.actor === "string" ? candidate.actor : undefined,
    note: typeof candidate.note === "string" ? candidate.note : undefined,
    sourceRunId: typeof candidate.sourceRunId === "string" ? candidate.sourceRunId : undefined,
    sourceStage: typeof candidate.sourceStage === "string" ? candidate.sourceStage : undefined,
    requestedCoderAgentId:
      typeof candidate.requestedCoderAgentId === "string"
        ? candidate.requestedCoderAgentId
        : undefined,
    requestedVerifierAgentId:
      typeof candidate.requestedVerifierAgentId === "string"
        ? candidate.requestedVerifierAgentId
        : undefined,
  };
}

function normalizeStatusSnapshot(raw: unknown): OpenClawCodeIssueStatusSnapshot | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeIssueStatusSnapshot>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.stage !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.owner !== "string" ||
    typeof candidate.repo !== "string" ||
    typeof candidate.issueNumber !== "number"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    status: candidate.status,
    stage: candidate.stage,
    runId: candidate.runId,
    updatedAt: candidate.updatedAt,
    owner: candidate.owner,
    repo: candidate.repo,
    issueNumber: candidate.issueNumber,
    branchName: typeof candidate.branchName === "string" ? candidate.branchName : undefined,
    worktreePath: typeof candidate.worktreePath === "string" ? candidate.worktreePath : undefined,
    pullRequestNumber:
      typeof candidate.pullRequestNumber === "number" ? candidate.pullRequestNumber : undefined,
    pullRequestUrl:
      typeof candidate.pullRequestUrl === "string" ? candidate.pullRequestUrl : undefined,
    notifyChannel:
      typeof candidate.notifyChannel === "string" ? candidate.notifyChannel : undefined,
    notifyTarget: typeof candidate.notifyTarget === "string" ? candidate.notifyTarget : undefined,
    latestReviewDecision:
      candidate.latestReviewDecision === "approved" ||
      candidate.latestReviewDecision === "changes-requested"
        ? candidate.latestReviewDecision
        : undefined,
    latestReviewSubmittedAt:
      typeof candidate.latestReviewSubmittedAt === "string"
        ? candidate.latestReviewSubmittedAt
        : undefined,
    latestReviewSummary:
      typeof candidate.latestReviewSummary === "string" ? candidate.latestReviewSummary : undefined,
    latestReviewUrl:
      typeof candidate.latestReviewUrl === "string" ? candidate.latestReviewUrl : undefined,
    rerunReason: typeof candidate.rerunReason === "string" ? candidate.rerunReason : undefined,
    rerunRequestedAt:
      typeof candidate.rerunRequestedAt === "string" ? candidate.rerunRequestedAt : undefined,
    rerunPriorRunId:
      typeof candidate.rerunPriorRunId === "string" ? candidate.rerunPriorRunId : undefined,
    rerunPriorStage:
      typeof candidate.rerunPriorStage === "string" ? candidate.rerunPriorStage : undefined,
    rerunRequestedCoderAgentId:
      typeof candidate.rerunRequestedCoderAgentId === "string"
        ? candidate.rerunRequestedCoderAgentId
        : undefined,
    rerunRequestedVerifierAgentId:
      typeof candidate.rerunRequestedVerifierAgentId === "string"
        ? candidate.rerunRequestedVerifierAgentId
        : undefined,
    suitabilityDecision:
      candidate.suitabilityDecision === "auto-run" ||
      candidate.suitabilityDecision === "needs-human-review" ||
      candidate.suitabilityDecision === "escalate"
        ? candidate.suitabilityDecision
        : undefined,
    suitabilitySummary:
      typeof candidate.suitabilitySummary === "string" ? candidate.suitabilitySummary : undefined,
    suitabilityAllowlisted:
      typeof candidate.suitabilityAllowlisted === "boolean"
        ? candidate.suitabilityAllowlisted
        : undefined,
    suitabilityDenylisted:
      typeof candidate.suitabilityDenylisted === "boolean"
        ? candidate.suitabilityDenylisted
        : undefined,
    suitabilityOverrideApplied:
      typeof candidate.suitabilityOverrideApplied === "boolean"
        ? candidate.suitabilityOverrideApplied
        : undefined,
    suitabilityOverrideActor:
      typeof candidate.suitabilityOverrideActor === "string"
        ? candidate.suitabilityOverrideActor
        : undefined,
    suitabilityOverrideReason:
      typeof candidate.suitabilityOverrideReason === "string"
        ? candidate.suitabilityOverrideReason
        : undefined,
    autoMergePolicyEligible:
      typeof candidate.autoMergePolicyEligible === "boolean"
        ? candidate.autoMergePolicyEligible
        : undefined,
    autoMergePolicyReason:
      typeof candidate.autoMergePolicyReason === "string"
        ? candidate.autoMergePolicyReason
        : undefined,
    autoMergeDisposition:
      candidate.autoMergeDisposition === "merged" ||
      candidate.autoMergeDisposition === "skipped" ||
      candidate.autoMergeDisposition === "failed"
        ? candidate.autoMergeDisposition
        : undefined,
    autoMergeDispositionReason:
      typeof candidate.autoMergeDispositionReason === "string"
        ? candidate.autoMergeDispositionReason
        : undefined,
    failureDiagnostics: normalizeWorkflowFailureDiagnostics(candidate.failureDiagnostics),
    providerFailureCount:
      typeof candidate.providerFailureCount === "number"
        ? candidate.providerFailureCount
        : undefined,
    lastProviderFailureAt:
      typeof candidate.lastProviderFailureAt === "string"
        ? candidate.lastProviderFailureAt
        : undefined,
    providerPauseUntil:
      typeof candidate.providerPauseUntil === "string" ? candidate.providerPauseUntil : undefined,
    providerPauseReason:
      typeof candidate.providerPauseReason === "string" ? candidate.providerPauseReason : undefined,
    lastNotificationChannel:
      typeof candidate.lastNotificationChannel === "string"
        ? candidate.lastNotificationChannel
        : undefined,
    lastNotificationTarget:
      typeof candidate.lastNotificationTarget === "string"
        ? candidate.lastNotificationTarget
        : undefined,
    lastNotificationAt:
      typeof candidate.lastNotificationAt === "string" ? candidate.lastNotificationAt : undefined,
    lastNotificationStatus:
      candidate.lastNotificationStatus === "sent" || candidate.lastNotificationStatus === "failed"
        ? candidate.lastNotificationStatus
        : undefined,
    lastNotificationError:
      typeof candidate.lastNotificationError === "string"
        ? candidate.lastNotificationError
        : undefined,
  };
}

function normalizeWorkflowFailureDiagnostics(raw: unknown): WorkflowFailureDiagnostics | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<WorkflowFailureDiagnostics>;
  const normalized: WorkflowFailureDiagnostics = {
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    systemPromptChars:
      typeof candidate.systemPromptChars === "number" ? candidate.systemPromptChars : undefined,
    skillsPromptChars:
      typeof candidate.skillsPromptChars === "number" ? candidate.skillsPromptChars : undefined,
    toolSchemaChars:
      typeof candidate.toolSchemaChars === "number" ? candidate.toolSchemaChars : undefined,
    toolCount: typeof candidate.toolCount === "number" ? candidate.toolCount : undefined,
    skillCount: typeof candidate.skillCount === "number" ? candidate.skillCount : undefined,
    injectedWorkspaceFileCount:
      typeof candidate.injectedWorkspaceFileCount === "number"
        ? candidate.injectedWorkspaceFileCount
        : undefined,
    bootstrapWarningShown:
      typeof candidate.bootstrapWarningShown === "boolean"
        ? candidate.bootstrapWarningShown
        : undefined,
    lastCallUsageTotal:
      typeof candidate.lastCallUsageTotal === "number" ? candidate.lastCallUsageTotal : undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function normalizeRepoNotificationBinding(
  raw: unknown,
): OpenClawCodeRepoNotificationBinding | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeRepoNotificationBinding>;
  if (
    typeof candidate.repoKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    repoKey: candidate.repoKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    updatedAt: candidate.updatedAt,
  };
}

function normalizeGitHubDeliveryRecord(raw: unknown): OpenClawCodeGitHubDeliveryRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeGitHubDeliveryRecord>;
  if (
    typeof candidate.deliveryId !== "string" ||
    typeof candidate.eventName !== "string" ||
    typeof candidate.action !== "string" ||
    typeof candidate.accepted !== "boolean" ||
    typeof candidate.reason !== "string" ||
    typeof candidate.receivedAt !== "string"
  ) {
    return undefined;
  }
  return {
    deliveryId: candidate.deliveryId,
    eventName: candidate.eventName,
    action: candidate.action,
    accepted: candidate.accepted,
    reason: candidate.reason,
    receivedAt: candidate.receivedAt,
    issueKey: typeof candidate.issueKey === "string" ? candidate.issueKey : undefined,
    pullRequestNumber:
      typeof candidate.pullRequestNumber === "number" ? candidate.pullRequestNumber : undefined,
  };
}

function normalizeTransientProviderFailureRecord(
  raw: unknown,
): OpenClawCodeTransientProviderFailureRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeTransientProviderFailureRecord>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.failedAt !== "string" ||
    typeof candidate.summary !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    runId: candidate.runId,
    failedAt: candidate.failedAt,
    summary: candidate.summary,
  };
}

function normalizeProviderPause(raw: unknown): OpenClawCodeProviderPause | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeProviderPause>;
  if (
    typeof candidate.until !== "string" ||
    typeof candidate.triggeredAt !== "string" ||
    typeof candidate.lastFailureAt !== "string" ||
    typeof candidate.failureCount !== "number" ||
    typeof candidate.reason !== "string"
  ) {
    return undefined;
  }
  return {
    until: candidate.until,
    triggeredAt: candidate.triggeredAt,
    lastFailureAt: candidate.lastFailureAt,
    failureCount: candidate.failureCount,
    reason: candidate.reason,
  };
}

function normalizePendingApproval(raw: unknown): OpenClawCodePendingApproval | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodePendingApproval>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    approvalKind:
      candidate.approvalKind === "manual" || candidate.approvalKind === "execution-start-gated"
        ? candidate.approvalKind
        : undefined,
  };
}

function buildStatusSnapshot(params: {
  run: WorkflowRun;
  status: string;
  notifyChannel?: string;
  notifyTarget?: string;
  notifiedAt?: string;
}): OpenClawCodeIssueStatusSnapshot {
  const autoMergePolicy = resolveAutoMergePolicy(params.run);
  const autoMergeDisposition = resolveAutoMergeDisposition(params.run);
  return {
    issueKey: `${params.run.issue.owner}/${params.run.issue.repo}#${params.run.issue.number}`,
    status: params.status,
    stage: params.run.stage,
    runId: params.run.id,
    updatedAt: params.run.updatedAt,
    owner: params.run.issue.owner,
    repo: params.run.issue.repo,
    issueNumber: params.run.issue.number,
    branchName: params.run.workspace?.branchName ?? params.run.buildResult?.branchName,
    worktreePath: params.run.workspace?.worktreePath,
    pullRequestNumber: params.run.draftPullRequest?.number,
    pullRequestUrl: params.run.draftPullRequest?.url,
    notifyChannel: params.notifyChannel,
    notifyTarget: params.notifyTarget,
    latestReviewDecision: params.run.rerunContext?.reviewDecision,
    latestReviewSubmittedAt: params.run.rerunContext?.reviewSubmittedAt,
    latestReviewSummary: params.run.rerunContext?.reviewSummary,
    latestReviewUrl: params.run.rerunContext?.reviewUrl,
    rerunReason: params.run.rerunContext?.reason,
    rerunRequestedAt: params.run.rerunContext?.requestedAt,
    rerunPriorRunId: params.run.rerunContext?.priorRunId,
    rerunPriorStage: params.run.rerunContext?.priorStage,
    rerunRequestedCoderAgentId: params.run.rerunContext?.requestedCoderAgentId,
    rerunRequestedVerifierAgentId: params.run.rerunContext?.requestedVerifierAgentId,
    suitabilityDecision: params.run.suitability?.decision,
    suitabilitySummary: params.run.suitability?.summary,
    suitabilityAllowlisted: params.run.suitability?.allowlisted,
    suitabilityDenylisted: params.run.suitability?.denylisted,
    suitabilityOverrideApplied: params.run.suitability?.overrideApplied,
    suitabilityOverrideActor: params.run.suitability?.overrideActor,
    suitabilityOverrideReason: params.run.suitability?.overrideReason,
    autoMergePolicyEligible: autoMergePolicy.autoMergePolicyEligible,
    autoMergePolicyReason: autoMergePolicy.autoMergePolicyReason,
    autoMergeDisposition: autoMergeDisposition.autoMergeDisposition ?? undefined,
    autoMergeDispositionReason: autoMergeDisposition.autoMergeDispositionReason ?? undefined,
    failureDiagnostics: params.run.failureDiagnostics,
    lastNotificationChannel: params.notifyChannel,
    lastNotificationTarget: params.notifyTarget,
    lastNotificationAt: params.notifiedAt,
    lastNotificationStatus: params.notifiedAt ? "sent" : undefined,
  };
}

function isTransientProviderFailureStatus(status: string): boolean {
  return PROVIDER_INTERNAL_ERROR_PATTERN.test(status);
}

function pruneRecentProviderFailures(
  entries: OpenClawCodeTransientProviderFailureRecord[],
  referenceAt: string,
): OpenClawCodeTransientProviderFailureRecord[] {
  const cutoff = new Date(referenceAt).getTime() - PROVIDER_FAILURE_WINDOW_MS;
  return entries.filter((entry) => new Date(entry.failedAt).getTime() >= cutoff);
}

function buildProviderPause(
  failures: OpenClawCodeTransientProviderFailureRecord[],
): OpenClawCodeProviderPause | undefined {
  if (failures.length < PROVIDER_FAILURE_THRESHOLD) {
    return undefined;
  }
  const lastFailureAt = failures[failures.length - 1]?.failedAt;
  if (!lastFailureAt) {
    return undefined;
  }
  return {
    until: new Date(new Date(lastFailureAt).getTime() + PROVIDER_PAUSE_MS).toISOString(),
    triggeredAt: lastFailureAt,
    lastFailureAt,
    failureCount: failures.length,
    reason: [
      `Paused after ${failures.length} recent provider-side transient failures.`,
      "Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
    ].join(" "),
  };
}

function applyProviderFailureStateFromSnapshot(
  state: OpenClawCodeQueueState,
  snapshot: OpenClawCodeIssueStatusSnapshot,
): void {
  snapshot.providerFailureCount = undefined;
  snapshot.lastProviderFailureAt = undefined;
  snapshot.providerPauseUntil = undefined;
  snapshot.providerPauseReason = undefined;

  if (snapshot.stage !== "failed") {
    state.recentProviderFailures = [];
    state.providerPause = undefined;
    return;
  }

  const recent = pruneRecentProviderFailures(state.recentProviderFailures, snapshot.updatedAt);
  if (!isTransientProviderFailureStatus(snapshot.status)) {
    state.recentProviderFailures = recent;
    state.providerPause =
      state.providerPause && state.providerPause.until > snapshot.updatedAt
        ? state.providerPause
        : undefined;
    return;
  }

  recent.push({
    issueKey: snapshot.issueKey,
    runId: snapshot.runId,
    failedAt: snapshot.updatedAt,
    summary: snapshot.status,
  });
  state.recentProviderFailures = recent;
  const pause = buildProviderPause(recent);
  state.providerPause = pause;
  snapshot.providerFailureCount = recent.length;
  snapshot.lastProviderFailureAt = snapshot.updatedAt;
  snapshot.providerPauseUntil = pause?.until;
  snapshot.providerPauseReason = pause?.reason;
}

function normalizeState(raw: unknown): OpenClawCodeQueueState {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultState();
  }
  const candidate = raw as Partial<OpenClawCodeQueueState>;
  const statusSnapshotsByIssue = Object.fromEntries(
    Object.entries(
      candidate.statusSnapshotsByIssue && typeof candidate.statusSnapshotsByIssue === "object"
        ? candidate.statusSnapshotsByIssue
        : {},
    ).flatMap(([issueKey, value]) => {
      const snapshot = normalizeStatusSnapshot(value);
      return snapshot ? [[issueKey, snapshot]] : [];
    }),
  );
  const repoBindingsByRepo = Object.fromEntries(
    Object.entries(
      candidate.repoBindingsByRepo && typeof candidate.repoBindingsByRepo === "object"
        ? candidate.repoBindingsByRepo
        : {},
    ).flatMap(([repoKey, value]) => {
      const binding = normalizeRepoNotificationBinding(value);
      return binding ? [[repoKey, binding]] : [];
    }),
  );
  const githubDeliveriesById = Object.fromEntries(
    Object.entries(
      candidate.githubDeliveriesById && typeof candidate.githubDeliveriesById === "object"
        ? candidate.githubDeliveriesById
        : {},
    ).flatMap(([deliveryId, value]) => {
      const record = normalizeGitHubDeliveryRecord(value);
      return record ? [[deliveryId, record]] : [];
    }),
  );
  const recentProviderFailures = Array.isArray(candidate.recentProviderFailures)
    ? candidate.recentProviderFailures.flatMap((value) => {
        const record = normalizeTransientProviderFailureRecord(value);
        return record ? [record] : [];
      })
    : [];
  return {
    version: 1,
    pendingApprovals: Array.isArray(candidate.pendingApprovals)
      ? candidate.pendingApprovals.flatMap((value) => {
          const pending = normalizePendingApproval(value);
          return pending ? [pending] : [];
        })
      : [],
    pendingIntakeDrafts: Array.isArray(candidate.pendingIntakeDrafts)
      ? candidate.pendingIntakeDrafts.flatMap((value) => {
          const draft = normalizePendingIntakeDraft(value);
          return draft ? [draft] : [];
        })
      : [],
    manualTakeovers: Array.isArray(candidate.manualTakeovers)
      ? candidate.manualTakeovers.flatMap((value) => {
          const takeover = normalizeManualTakeover(value);
          return takeover ? [takeover] : [];
        })
      : [],
    deferredRuntimeReroutes: Array.isArray(candidate.deferredRuntimeReroutes)
      ? candidate.deferredRuntimeReroutes.flatMap((value) => {
          const record = normalizeDeferredRuntimeReroute(value);
          return record ? [record] : [];
        })
      : [],
    queue: Array.isArray(candidate.queue) ? candidate.queue : [],
    currentRun:
      candidate.currentRun && typeof candidate.currentRun === "object"
        ? candidate.currentRun
        : undefined,
    statusByIssue:
      candidate.statusByIssue && typeof candidate.statusByIssue === "object"
        ? candidate.statusByIssue
        : {},
    statusSnapshotsByIssue,
    repoBindingsByRepo,
    githubDeliveriesById,
    recentProviderFailures,
    providerPause: normalizeProviderPause(candidate.providerPause),
  };
}

export class OpenClawCodeChatopsStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly statePath: string) {}

  static fromStateDir(stateDir: string): OpenClawCodeChatopsStore {
    return new OpenClawCodeChatopsStore(
      path.join(stateDir, "plugins", "openclawcode", "chatops-state.json"),
    );
  }

  private async loadState(): Promise<OpenClawCodeQueueState> {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      return normalizeState(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return cloneDefaultState();
      }
      throw error;
    }
  }

  private async flushMutations(): Promise<void> {
    await this.mutationQueue;
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.catch(() => undefined);
    const next = pending.then(operation);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  }

  private async mutateState<T>(
    mutator: (state: OpenClawCodeQueueState) => Promise<T> | T,
  ): Promise<T> {
    return await this.withMutationLock(async () => {
      const state = await this.loadState();
      const result = await mutator(state);
      await this.saveState(state);
      return result;
    });
  }

  private async saveState(state: OpenClawCodeQueueState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.statePath);
  }

  async getStatus(issueKey: string): Promise<string | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.statusByIssue[issueKey];
  }

  async getPendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingApprovals.find((entry) => entry.issueKey === issueKey);
  }

  async getPendingIntakeDraft(params: {
    repoKey: string;
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<OpenClawCodePendingIntakeDraft | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingIntakeDrafts.find(
      (entry) =>
        entry.repoKey === params.repoKey &&
        entry.notifyChannel === params.notifyChannel &&
        entry.notifyTarget === params.notifyTarget,
    );
  }

  async getManualTakeover(issueKey: string): Promise<OpenClawCodeManualTakeover | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.manualTakeovers.find((entry) => entry.issueKey === issueKey);
  }

  async getDeferredRuntimeReroute(
    issueKey: string,
  ): Promise<OpenClawCodeDeferredRuntimeReroute | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.deferredRuntimeReroutes.find((entry) => entry.issueKey === issueKey);
  }

  async getStatusSnapshot(issueKey: string): Promise<OpenClawCodeIssueStatusSnapshot | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.statusSnapshotsByIssue[issueKey];
  }

  async findStatusSnapshotByPullRequest(params: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
  }): Promise<OpenClawCodeIssueStatusSnapshot | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    const owner = params.owner.toLowerCase();
    const repo = params.repo.toLowerCase();
    return Object.values(state.statusSnapshotsByIssue).find(
      (snapshot) =>
        snapshot.pullRequestNumber === params.pullRequestNumber &&
        snapshot.owner.toLowerCase() === owner &&
        snapshot.repo.toLowerCase() === repo,
    );
  }

  async getRepoBinding(repoKey: string): Promise<OpenClawCodeRepoNotificationBinding | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.repoBindingsByRepo[repoKey];
  }

  async listRepoBindings(): Promise<OpenClawCodeRepoNotificationBinding[]> {
    await this.flushMutations();
    const state = await this.loadState();
    return Object.values(state.repoBindingsByRepo);
  }

  async getGitHubDelivery(
    deliveryId: string,
  ): Promise<OpenClawCodeGitHubDeliveryRecord | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.githubDeliveriesById[deliveryId];
  }

  async setStatus(issueKey: string, status: string): Promise<void> {
    await this.mutateState((state) => {
      state.statusByIssue[issueKey] = status;
      const currentSnapshot = state.statusSnapshotsByIssue[issueKey];
      if (currentSnapshot) {
        state.statusSnapshotsByIssue[issueKey] = {
          ...currentSnapshot,
          status,
        };
      }
    });
  }

  async recordWorkflowRunStatus(
    run: WorkflowRun,
    status: string,
    notify?: {
      notifyChannel?: string;
      notifyTarget?: string;
    },
  ): Promise<void> {
    await this.mutateState((state) => {
      const snapshot = buildStatusSnapshot({
        run,
        status,
        notifyChannel: notify?.notifyChannel,
        notifyTarget: notify?.notifyTarget,
        notifiedAt:
          notify?.notifyChannel && notify?.notifyTarget ? new Date().toISOString() : undefined,
      });
      state.statusByIssue[snapshot.issueKey] = status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
      applyProviderFailureStateFromSnapshot(state, snapshot);
    });
  }

  async setStatusSnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): Promise<void> {
    await this.mutateState((state) => {
      state.statusByIssue[snapshot.issueKey] = snapshot.status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
    });
  }

  async recordPrecheckedEscalation(snapshot: OpenClawCodeIssueStatusSnapshot): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === snapshot.issueKey) ||
        state.currentRun?.issueKey === snapshot.issueKey ||
        state.queue.some((entry) => entry.issueKey === snapshot.issueKey)
      ) {
        return false;
      }
      state.statusByIssue[snapshot.issueKey] = snapshot.status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
      return true;
    });
  }

  async recordSnapshotNotification(params: {
    issueKey: string;
    notifyChannel: string;
    notifyTarget: string;
    notifiedAt: string;
    status: "sent" | "failed";
    error?: string;
  }): Promise<void> {
    await this.mutateState((state) => {
      const snapshot = state.statusSnapshotsByIssue[params.issueKey];
      if (!snapshot) {
        return;
      }
      state.statusSnapshotsByIssue[params.issueKey] = {
        ...snapshot,
        notifyChannel: params.notifyChannel,
        notifyTarget: params.notifyTarget,
        lastNotificationChannel: params.notifyChannel,
        lastNotificationTarget: params.notifyTarget,
        lastNotificationAt: params.notifiedAt,
        lastNotificationStatus: params.status,
        lastNotificationError: params.status === "failed" ? params.error : undefined,
      };
    });
  }

  async setRepoBinding(params: {
    repoKey: string;
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<OpenClawCodeRepoNotificationBinding> {
    return await this.mutateState((state) => {
      const binding: OpenClawCodeRepoNotificationBinding = {
        repoKey: params.repoKey,
        notifyChannel: params.notifyChannel,
        notifyTarget: params.notifyTarget,
        updatedAt: new Date().toISOString(),
      };
      state.repoBindingsByRepo[params.repoKey] = binding;
      return binding;
    });
  }

  async removeRepoBinding(repoKey: string): Promise<boolean> {
    return await this.mutateState((state) => {
      if (!state.repoBindingsByRepo[repoKey]) {
        return false;
      }
      delete state.repoBindingsByRepo[repoKey];
      return true;
    });
  }

  async recordGitHubDelivery(
    record: OpenClawCodeGitHubDeliveryRecord,
  ): Promise<OpenClawCodeGitHubDeliveryRecord> {
    return await this.mutateState((state) => {
      const existing = state.githubDeliveriesById[record.deliveryId];
      if (existing) {
        return existing;
      }
      state.githubDeliveriesById[record.deliveryId] = record;
      const deliveryIds = Object.keys(state.githubDeliveriesById);
      const overflow = deliveryIds.length - MAX_GITHUB_DELIVERY_RECORDS;
      if (overflow > 0) {
        for (const deliveryId of deliveryIds.slice(0, overflow)) {
          delete state.githubDeliveriesById[deliveryId];
        }
      }
      return record;
    });
  }

  async reconcileStatuses(statuses: Record<string, string>): Promise<void> {
    await this.mutateState((state) => {
      for (const [issueKey, status] of Object.entries(statuses)) {
        const isActive =
          state.pendingApprovals.some((entry) => entry.issueKey === issueKey) ||
          state.currentRun?.issueKey === issueKey ||
          state.queue.some((entry) => entry.issueKey === issueKey);
        if (isActive) {
          continue;
        }
        state.statusByIssue[issueKey] = status;
      }
    });
  }

  async reconcileWorkflowRunStatuses(
    records: Array<{
      issueKey: string;
      status: string;
      run: WorkflowRun;
    }>,
  ): Promise<void> {
    await this.mutateState((state) => {
      const orderedRecords = [...records].toSorted((left, right) =>
        left.run.updatedAt.localeCompare(right.run.updatedAt),
      );
      for (const record of orderedRecords) {
        const isActive =
          state.pendingApprovals.some((entry) => entry.issueKey === record.issueKey) ||
          state.currentRun?.issueKey === record.issueKey ||
          state.queue.some((entry) => entry.issueKey === record.issueKey);
        if (isActive) {
          continue;
        }
        const currentSnapshot = state.statusSnapshotsByIssue[record.issueKey];
        if (currentSnapshot && currentSnapshot.updatedAt > record.run.updatedAt) {
          continue;
        }
        state.statusByIssue[record.issueKey] = record.status;
        const snapshot = buildStatusSnapshot(record);
        state.statusSnapshotsByIssue[record.issueKey] = snapshot;
        applyProviderFailureStateFromSnapshot(state, snapshot);
      }
    });
  }

  async addPendingApproval(
    pending: OpenClawCodePendingApproval,
    status = "Awaiting chat approval.",
  ): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === pending.issueKey) ||
        state.currentRun?.issueKey === pending.issueKey ||
        state.queue.some((entry) => entry.issueKey === pending.issueKey)
      ) {
        return false;
      }
      state.pendingApprovals.push(pending);
      state.statusByIssue[pending.issueKey] = status;
      return true;
    });
  }

  async upsertPendingApproval(
    pending: OpenClawCodePendingApproval,
    status = "Awaiting chat approval.",
  ): Promise<"added" | "updated" | "already-tracked"> {
    return await this.mutateState((state) => {
      if (
        state.currentRun?.issueKey === pending.issueKey ||
        state.queue.some((entry) => entry.issueKey === pending.issueKey)
      ) {
        return "already-tracked";
      }
      const existingIndex = state.pendingApprovals.findIndex(
        (entry) => entry.issueKey === pending.issueKey,
      );
      if (existingIndex >= 0) {
        const existing = state.pendingApprovals[existingIndex];
        state.pendingApprovals[existingIndex] = {
          ...existing,
          ...pending,
          approvalKind: pending.approvalKind ?? existing?.approvalKind,
        };
        state.statusByIssue[pending.issueKey] = status;
        return "updated";
      }
      state.pendingApprovals.push(pending);
      state.statusByIssue[pending.issueKey] = status;
      return "added";
    });
  }

  async upsertPendingIntakeDraft(
    draft: OpenClawCodePendingIntakeDraft,
  ): Promise<"added" | "updated"> {
    return await this.mutateState((state) => {
      const existingIndex = state.pendingIntakeDrafts.findIndex(
        (entry) =>
          entry.repoKey === draft.repoKey &&
          entry.notifyChannel === draft.notifyChannel &&
          entry.notifyTarget === draft.notifyTarget,
      );
      if (existingIndex >= 0) {
        const existing = state.pendingIntakeDrafts[existingIndex];
        state.pendingIntakeDrafts[existingIndex] = {
          ...existing,
          ...draft,
          createdAt: existing?.createdAt ?? draft.createdAt,
        };
        return "updated";
      }
      state.pendingIntakeDrafts.push(draft);
      return "added";
    });
  }

  async removePendingIntakeDraft(params: {
    repoKey: string;
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.pendingIntakeDrafts.findIndex(
        (entry) =>
          entry.repoKey === params.repoKey &&
          entry.notifyChannel === params.notifyChannel &&
          entry.notifyTarget === params.notifyTarget,
      );
      if (index < 0) {
        return false;
      }
      state.pendingIntakeDrafts.splice(index, 1);
      return true;
    });
  }

  async upsertManualTakeover(takeover: OpenClawCodeManualTakeover): Promise<"added" | "updated"> {
    return await this.mutateState((state) => {
      const existingIndex = state.manualTakeovers.findIndex(
        (entry) => entry.issueKey === takeover.issueKey,
      );
      if (existingIndex >= 0) {
        state.manualTakeovers[existingIndex] = {
          ...state.manualTakeovers[existingIndex],
          ...takeover,
        };
        return "updated";
      }
      state.manualTakeovers.push(takeover);
      return "added";
    });
  }

  async removeManualTakeover(issueKey: string): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.manualTakeovers.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.manualTakeovers.splice(index, 1);
      return true;
    });
  }

  async upsertDeferredRuntimeReroute(
    record: OpenClawCodeDeferredRuntimeReroute,
  ): Promise<"added" | "updated"> {
    return await this.mutateState((state) => {
      const existingIndex = state.deferredRuntimeReroutes.findIndex(
        (entry) => entry.issueKey === record.issueKey,
      );
      if (existingIndex >= 0) {
        const existing = state.deferredRuntimeReroutes[existingIndex];
        state.deferredRuntimeReroutes[existingIndex] = {
          ...existing,
          ...record,
          requestedCoderAgentId: record.requestedCoderAgentId ?? existing.requestedCoderAgentId,
          requestedVerifierAgentId:
            record.requestedVerifierAgentId ?? existing.requestedVerifierAgentId,
        };
        return "updated";
      }
      state.deferredRuntimeReroutes.push(record);
      return "added";
    });
  }

  async removeDeferredRuntimeReroute(issueKey: string): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.deferredRuntimeReroutes.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.deferredRuntimeReroutes.splice(index, 1);
      return true;
    });
  }

  async consumePendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    return await this.mutateState((state) => {
      const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return undefined;
      }
      const [pending] = state.pendingApprovals.splice(index, 1);
      return pending;
    });
  }

  async removePendingApproval(
    issueKey: string,
    status = "Skipped before execution.",
  ): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.pendingApprovals.splice(index, 1);
      state.statusByIssue[issueKey] = status;
      return true;
    });
  }

  async isPendingApproval(issueKey: string): Promise<boolean> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingApprovals.some((entry) => entry.issueKey === issueKey);
  }

  async isQueuedOrRunning(issueKey: string): Promise<boolean> {
    await this.flushMutations();
    const state = await this.loadState();
    return (
      state.currentRun?.issueKey === issueKey ||
      state.queue.some((entry) => entry.issueKey === issueKey)
    );
  }

  async enqueue(run: OpenClawCodeQueuedRun, status = "Queued."): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === run.issueKey) ||
        state.currentRun?.issueKey === run.issueKey ||
        state.queue.some((entry) => entry.issueKey === run.issueKey)
      ) {
        return false;
      }
      state.queue.push(run);
      state.statusByIssue[run.issueKey] = status;
      return true;
    });
  }

  async updateQueuedRuntimeReroute(params: {
    issueKey: string;
    requestedCoderAgentId?: string;
    requestedVerifierAgentId?: string;
    requestedAt: string;
    reason: string;
  }): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      const index = state.queue.findIndex((entry) => entry.issueKey === params.issueKey);
      if (index < 0) {
        return undefined;
      }
      const queued = state.queue[index];
      if (!queued) {
        return undefined;
      }
      const next: OpenClawCodeQueuedRun = {
        ...queued,
        request: {
          ...queued.request,
          builderAgent: params.requestedCoderAgentId?.trim() || queued.request.builderAgent,
          verifierAgent: params.requestedVerifierAgentId?.trim() || queued.request.verifierAgent,
          rerunContext: queued.request.rerunContext
            ? {
                ...queued.request.rerunContext,
                requestedAt: params.requestedAt,
                reason: params.reason,
                requestedCoderAgentId:
                  params.requestedCoderAgentId?.trim() ||
                  queued.request.rerunContext.requestedCoderAgentId,
                requestedVerifierAgentId:
                  params.requestedVerifierAgentId?.trim() ||
                  queued.request.rerunContext.requestedVerifierAgentId,
              }
            : queued.request.rerunContext,
        },
      };
      state.queue[index] = next;
      state.statusByIssue[params.issueKey] = `Queued with runtime reroute overrides.`;
      return next;
    });
  }

  async promotePendingApprovalToQueue(params: {
    issueKey: string;
    request: OpenClawCodeChatopsRunRequest;
    fallbackNotifyChannel: string;
    fallbackNotifyTarget: string;
    status?: string;
  }): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      if (
        state.currentRun?.issueKey === params.issueKey ||
        state.queue.some((entry) => entry.issueKey === params.issueKey)
      ) {
        return undefined;
      }

      const pendingIndex = state.pendingApprovals.findIndex(
        (entry) => entry.issueKey === params.issueKey,
      );
      const pending = pendingIndex >= 0 ? state.pendingApprovals[pendingIndex] : undefined;
      if (pendingIndex >= 0) {
        state.pendingApprovals.splice(pendingIndex, 1);
      }

      const queuedRun: OpenClawCodeQueuedRun = {
        issueKey: params.issueKey,
        request: params.request,
        notifyChannel: pending?.notifyChannel ?? params.fallbackNotifyChannel,
        notifyTarget: pending?.notifyTarget ?? params.fallbackNotifyTarget,
      };
      state.queue.push(queuedRun);
      state.statusByIssue[params.issueKey] = params.status ?? "Queued.";
      return queuedRun;
    });
  }

  async removeQueued(issueKey: string, status = "Skipped before execution."): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.queue.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.queue.splice(index, 1);
      state.statusByIssue[issueKey] = status;
      return true;
    });
  }

  async startNext(status = "Running."): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      if (state.currentRun) {
        return undefined;
      }
      const next = state.queue.shift();
      if (!next) {
        return undefined;
      }
      state.currentRun = next;
      state.statusByIssue[next.issueKey] = status;
      return next;
    });
  }

  async getActiveProviderPause(
    referenceAt = new Date().toISOString(),
  ): Promise<OpenClawCodeProviderPause | undefined> {
    return await this.mutateState((state) => {
      state.recentProviderFailures = pruneRecentProviderFailures(
        state.recentProviderFailures,
        referenceAt,
      );
      const pause = state.providerPause;
      if (!pause) {
        return undefined;
      }
      if (
        pause.until <= referenceAt ||
        state.recentProviderFailures.length < PROVIDER_FAILURE_THRESHOLD
      ) {
        state.providerPause = undefined;
        return undefined;
      }
      return pause;
    });
  }

  async finishCurrent(issueKey: string, status: string): Promise<void> {
    await this.mutateState((state) => {
      if (state.currentRun?.issueKey !== issueKey) {
        return;
      }
      state.currentRun = undefined;
      state.statusByIssue[issueKey] = status;
    });
  }

  async recoverInterruptedRun(
    status = "Recovered after restart; waiting to resume.",
  ): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      const current = state.currentRun;
      if (!current) {
        return undefined;
      }
      state.currentRun = undefined;
      if (!state.queue.some((entry) => entry.issueKey === current.issueKey)) {
        state.queue.unshift(current);
      }
      state.statusByIssue[current.issueKey] = status;
      return current;
    });
  }

  async snapshot(): Promise<OpenClawCodeQueueState> {
    await this.flushMutations();
    return await this.loadState();
  }
}
