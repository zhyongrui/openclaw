import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readRequestBodyWithLimit } from "../../src/infra/http-body.js";
import {
  OpenClawCodeChatopsStore,
  applyPullRequestReviewWebhookToSnapshot,
  applyPullRequestWebhookToSnapshot,
  buildIssueApprovalMessage,
  buildOpenClawCodeRunArgv,
  buildRunRequestFromCommand,
  buildRunStatusMessage,
  decideIssueWebhookIntake,
  extractWorkflowRunFromCommandOutput,
  findLatestLocalRunStatusForIssue,
  formatIssueKey,
  formatRepoKey,
  parseChatopsCommand,
  parseChatopsRepoReference,
  collectLatestLocalRunStatuses,
  resolveOpenClawCodePluginConfig,
  readGitHubRepositoryOwner,
  syncIssueSnapshotFromGitHub,
  type GitHubIssueWebhookEvent,
  type GitHubPullRequestReviewWebhookEvent,
  type GitHubPullRequestWebhookEvent,
  type OpenClawCodeChatopsRepoConfig,
  type OpenClawCodeIssueStatusSnapshot,
} from "../../src/integrations/openclaw-plugin/index.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_WEBHOOK_MAX_BYTES = 256 * 1024;
const SUPPORTED_GITHUB_EVENTS = new Set(["issues", "pull_request", "pull_request_review"]);

let workerActive = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

type GitHubWebhookPayload =
  | GitHubIssueWebhookEvent
  | GitHubPullRequestWebhookEvent
  | GitHubPullRequestReviewWebhookEvent;

function resolveRepoConfig(
  repoConfigs: OpenClawCodeChatopsRepoConfig[],
  issue: { owner: string; repo: string },
): OpenClawCodeChatopsRepoConfig | undefined {
  return repoConfigs.find(
    (config) =>
      config.owner.toLowerCase() === issue.owner.toLowerCase() &&
      config.repo.toLowerCase() === issue.repo.toLowerCase(),
  );
}

function resolveDefaultRepoConfig(
  repoConfigs: OpenClawCodeChatopsRepoConfig[],
): OpenClawCodeChatopsRepoConfig | undefined {
  return repoConfigs.length === 1 ? repoConfigs[0] : undefined;
}

function resolveCommandNotifyTarget(ctx: {
  to?: string;
  from?: string;
  senderId?: string;
}): string | undefined {
  return ctx.to?.trim() || ctx.from?.trim() || ctx.senderId?.trim();
}

function issueKeyMatchesRepo(issueKey: string, repo: { owner: string; repo: string }): boolean {
  return issueKey.toLowerCase().startsWith(`${formatRepoKey(repo).toLowerCase()}#`);
}

function formatStageLabel(stage: string): string {
  return stage
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function trimToSingleLine(value: string | undefined): string | undefined {
  const singleLine = value
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return singleLine && singleLine.length > 0 ? singleLine : undefined;
}

function summarizeRecentSnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): string {
  const details = [
    formatStageLabel(snapshot.stage),
    snapshot.pullRequestNumber ? `PR #${snapshot.pullRequestNumber}` : undefined,
    snapshot.updatedAt,
  ].filter(Boolean);
  return `${snapshot.issueKey} ${details.join(" | ")}`;
}

function buildInboxMessage(params: {
  repo: { owner: string; repo: string };
  state: Awaited<ReturnType<OpenClawCodeChatopsStore["snapshot"]>>;
}): string {
  const repoKey = formatRepoKey(params.repo);
  const pending = params.state.pendingApprovals
    .filter((entry) => issueKeyMatchesRepo(entry.issueKey, params.repo))
    .map((entry) => ({
      issueKey: entry.issueKey,
      summary:
        trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Awaiting chat approval.",
    }));
  const running =
    params.state.currentRun && issueKeyMatchesRepo(params.state.currentRun.issueKey, params.repo)
      ? [
          {
            issueKey: params.state.currentRun.issueKey,
            summary:
              trimToSingleLine(params.state.statusByIssue[params.state.currentRun.issueKey]) ??
              "Running.",
          },
        ]
      : [];
  const queued = params.state.queue
    .filter((entry) => issueKeyMatchesRepo(entry.issueKey, params.repo))
    .map((entry) => ({
      issueKey: entry.issueKey,
      summary: trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Queued.",
    }));
  const activeIssueKeys = new Set([
    ...pending.map((entry) => entry.issueKey),
    ...running.map((entry) => entry.issueKey),
    ...queued.map((entry) => entry.issueKey),
  ]);
  const recent = Object.values(params.state.statusSnapshotsByIssue)
    .filter((snapshot) => issueKeyMatchesRepo(snapshot.issueKey, params.repo))
    .filter((snapshot) => !activeIssueKeys.has(snapshot.issueKey))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5);

  const lines = [`openclawcode inbox for ${repoKey}`];

  if (pending.length > 0) {
    lines.push(`Pending approvals: ${pending.length}`);
    for (const entry of pending) {
      lines.push(`- ${entry.issueKey} | ${entry.summary}`);
    }
  } else {
    lines.push("Pending approvals: 0");
  }

  if (running.length > 0) {
    lines.push(`Running: ${running.length}`);
    for (const entry of running) {
      lines.push(`- ${entry.issueKey} | ${entry.summary}`);
    }
  } else {
    lines.push("Running: 0");
  }

  if (queued.length > 0) {
    lines.push(`Queued: ${queued.length}`);
    for (const entry of queued) {
      lines.push(`- ${entry.issueKey} | ${entry.summary}`);
    }
  } else {
    lines.push("Queued: 0");
  }

  if (recent.length > 0) {
    lines.push(`Recent completed: ${recent.length}`);
    for (const entry of recent) {
      lines.push(`- ${summarizeRecentSnapshot(entry)}`);
    }
  } else {
    lines.push("Recent completed: 0");
  }

  return lines.join("\n");
}

function summarizeFailure(stderr: string, stdout: string): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  if (!combined) {
    return "Command failed without output.";
  }
  const lines = combined.split("\n").filter(Boolean);
  return lines.slice(-8).join("\n");
}

async function reconcileLocalRunStatuses(params: {
  store: OpenClawCodeChatopsStore;
  repoConfigs: OpenClawCodeChatopsRepoConfig[];
}): Promise<void> {
  const records: Array<{
    issueKey: string;
    status: string;
    run: Awaited<ReturnType<typeof collectLatestLocalRunStatuses>>[number]["run"];
  }> = [];
  for (const repo of params.repoConfigs) {
    const repoRecords = await collectLatestLocalRunStatuses(repo);
    for (const record of repoRecords) {
      records.push(record);
    }
  }
  await params.store.reconcileWorkflowRunStatuses(records);
}

async function syncSnapshotsFromGitHub(store: OpenClawCodeChatopsStore): Promise<{
  checked: number;
  changed: number;
  failed: number;
}> {
  const snapshotState = await store.snapshot();
  let checked = 0;
  let changed = 0;
  let failed = 0;

  for (const snapshot of Object.values(snapshotState.statusSnapshotsByIssue)) {
    checked += 1;
    try {
      const synced = await syncIssueSnapshotFromGitHub({ snapshot });
      if (!synced.changed) {
        continue;
      }
      await store.setStatusSnapshot(synced.snapshot);
      changed += 1;
    } catch {
      failed += 1;
    }
  }

  return { checked, changed, failed };
}

async function sendText(params: {
  api: OpenClawPluginApi;
  channel: string;
  target: string;
  text: string;
}): Promise<void> {
  const { runMessageAction } = await import("../../src/infra/outbound/message-action-runner.js");
  await runMessageAction({
    cfg: params.api.config,
    action: "send",
    params: {
      channel: params.channel,
      to: params.target,
      message: params.text,
    },
  });
}

function scheduleNotification(params: {
  api: OpenClawPluginApi;
  channel: string;
  target: string;
  text: string;
}): void {
  void sendText(params).catch((error) => {
    params.api.logger.warn(
      `openclawcode notification failed for ${params.channel}:${params.target}: ${String(error)}`,
    );
  });
}

function resolveNotificationDestination(params: {
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  snapshot?: OpenClawCodeIssueStatusSnapshot;
}): {
  channel: string;
  target: string;
} {
  return {
    channel:
      params.snapshot?.notifyChannel ??
      params.binding?.notifyChannel ??
      params.repoConfig.notifyChannel,
    target:
      params.snapshot?.notifyTarget ??
      params.binding?.notifyTarget ??
      params.repoConfig.notifyTarget,
  };
}

function resolveGithubSecret(
  pluginConfig: Record<string, unknown> | undefined,
): string | undefined {
  const resolved = resolveOpenClawCodePluginConfig(pluginConfig);
  const envName = resolved.githubWebhookSecretEnv;
  if (!envName) {
    return undefined;
  }
  const value = process.env[envName];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyGithubSignature(params: {
  body: string;
  req: IncomingMessage;
  secret?: string;
}): boolean {
  if (!params.secret) {
    return true;
  }
  const provided = params.req.headers["x-hub-signature-256"];
  const signature = Array.isArray(provided) ? provided[0] : provided;
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    return false;
  }
  const digest = crypto.createHmac("sha256", params.secret).update(params.body).digest("hex");
  return timingSafeEqualHex(signature, `sha256=${digest}`);
}

function readSingleHeaderValue(
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function handleIssueWebhookEvent(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  payload: GitHubIssueWebhookEvent;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  respondJson: (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const decision = decideIssueWebhookIntake({
    event: params.payload,
    config: params.repoConfig,
  });
  if (!decision.accept || !decision.issue) {
    return await params.respondJson({
      accepted: false,
      reason: decision.reason,
    });
  }

  const issueKey = formatIssueKey(decision.issue);
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
  });
  if (params.repoConfig.triggerMode === "auto") {
    const enqueued = await params.store.enqueue(
      {
        issueKey,
        notifyChannel: destination.channel,
        notifyTarget: destination.target,
        request: buildRunRequestFromCommand({
          command: {
            action: "start",
            issue: {
              owner: decision.issue.owner,
              repo: decision.issue.repo,
              number: decision.issue.number,
            },
          },
          config: params.repoConfig,
        }),
      },
      "Auto-started from issue webhook.",
    );
    if (!enqueued) {
      return await params.respondJson({
        accepted: false,
        reason: "already-tracked",
        issue: issueKey,
      });
    }
    scheduleNotification({
      api: params.api,
      channel: destination.channel,
      target: destination.target,
      text: [
        "openclawcode auto-started a new GitHub issue.",
        `Issue: ${issueKey}`,
        `Title: ${decision.issue.title}`,
        "Mode: auto",
        "Status: queued for execution",
      ].join("\n"),
    });
  } else {
    const approvalMessage = buildIssueApprovalMessage({
      issue: decision.issue,
      config: params.repoConfig,
    });
    const accepted = await params.store.addPendingApproval({
      issueKey,
      notifyChannel: destination.channel,
      notifyTarget: destination.target,
    });
    if (!accepted) {
      return await params.respondJson({
        accepted: false,
        reason: "already-tracked",
        issue: issueKey,
      });
    }
    scheduleNotification({
      api: params.api,
      channel: destination.channel,
      target: destination.target,
      text: approvalMessage,
    });
  }

  return await params.respondJson({
    accepted: true,
    reason: params.repoConfig.triggerMode === "auto" ? "auto-enqueued" : "announced-for-approval",
    issue: issueKey,
  });
}

async function handlePullRequestWebhookEvent(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  payload: GitHubPullRequestWebhookEvent;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  respondJson: (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const snapshot = await params.store.findStatusSnapshotByPullRequest({
    owner: params.repoConfig.owner,
    repo: params.repoConfig.repo,
    pullRequestNumber: params.payload.pull_request.number,
  });
  if (!snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: "untracked-pull-request",
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  const applied = applyPullRequestWebhookToSnapshot({
    snapshot,
    event: params.payload,
  });
  if (!applied.accepted || !applied.snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: applied.reason,
      issue: snapshot.issueKey,
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  await params.store.setStatusSnapshot(applied.snapshot);
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot: applied.snapshot,
  });
  scheduleNotification({
    api: params.api,
    channel: destination.channel,
    target: destination.target,
    text: applied.snapshot.status,
  });
  return await params.respondJson({
    accepted: true,
    reason: applied.reason,
    issue: applied.snapshot.issueKey,
    pullRequestNumber: params.payload.pull_request.number,
  });
}

async function handlePullRequestReviewWebhookEvent(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  payload: GitHubPullRequestReviewWebhookEvent;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  respondJson: (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const snapshot = await params.store.findStatusSnapshotByPullRequest({
    owner: params.repoConfig.owner,
    repo: params.repoConfig.repo,
    pullRequestNumber: params.payload.pull_request.number,
  });
  if (!snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: "untracked-pull-request",
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  const applied = applyPullRequestReviewWebhookToSnapshot({
    snapshot,
    event: params.payload,
  });
  if (!applied.accepted || !applied.snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: applied.reason,
      issue: snapshot.issueKey,
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  await params.store.setStatusSnapshot(applied.snapshot);
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot: applied.snapshot,
  });
  scheduleNotification({
    api: params.api,
    channel: destination.channel,
    target: destination.target,
    text: applied.snapshot.status,
  });
  return await params.respondJson({
    accepted: true,
    reason: applied.reason,
    issue: applied.snapshot.issueKey,
    pullRequestNumber: params.payload.pull_request.number,
  });
}

async function handleGithubWebhook(
  api: OpenClawPluginApi,
  store: OpenClawCodeChatopsStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  const githubEvent = readSingleHeaderValue(req.headers, "x-github-event");
  const githubDeliveryId = readSingleHeaderValue(req.headers, "x-github-delivery");
  if (!githubEvent || !SUPPORTED_GITHUB_EVENTS.has(githubEvent)) {
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ accepted: false, reason: "ignored-event" }));
    return true;
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBodyWithLimit(req, { maxBytes: DEFAULT_WEBHOOK_MAX_BYTES });
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(error instanceof Error ? error.message : String(error));
    return true;
  }

  if (
    !verifyGithubSignature({
      body: rawBody,
      req,
      secret: resolveGithubSecret(api.pluginConfig),
    })
  ) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid signature");
    return true;
  }

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid JSON");
    return true;
  }

  const respondJson = async (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }): Promise<boolean> => {
    if (githubDeliveryId && params.recordDelivery !== false) {
      await store.recordGitHubDelivery({
        deliveryId: githubDeliveryId,
        eventName: githubEvent,
        action: payload.action,
        accepted: params.accepted,
        reason: params.reason,
        receivedAt: new Date().toISOString(),
        issueKey: params.issue,
        pullRequestNumber: params.pullRequestNumber,
      });
    }
    res.statusCode = params.statusCode ?? 202;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        accepted: params.accepted,
        reason: params.reason,
        issue: params.issue,
        pullRequest: params.pullRequestNumber,
        ...params.extra,
      }),
    );
    return true;
  };

  if (githubDeliveryId) {
    const existingDelivery = await store.getGitHubDelivery(githubDeliveryId);
    if (existingDelivery) {
      return await respondJson({
        accepted: false,
        reason: "duplicate-delivery",
        issue: existingDelivery.issueKey,
        pullRequestNumber: existingDelivery.pullRequestNumber,
        recordDelivery: false,
        extra: {
          delivery: githubDeliveryId,
          previousReason: existingDelivery.reason,
        },
      });
    }
  }

  const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
  const repositoryOwner = readGitHubRepositoryOwner(payload.repository.owner);
  if (!repositoryOwner) {
    return await respondJson({
      accepted: false,
      reason: "invalid-repository-owner",
    });
  }
  const matchingRepo = resolveRepoConfig(pluginConfig.repos, {
    owner: repositoryOwner,
    repo: payload.repository.name,
  });
  if (!matchingRepo) {
    return await respondJson({
      accepted: false,
      reason: "unconfigured-repo",
    });
  }

  const repoKey = formatRepoKey({
    owner: matchingRepo.owner,
    repo: matchingRepo.repo,
  });
  const binding = await store.getRepoBinding(repoKey);
  if (githubEvent === "issues") {
    return await handleIssueWebhookEvent({
      api,
      store,
      payload: payload as GitHubIssueWebhookEvent,
      repoConfig: matchingRepo,
      binding,
      respondJson,
    });
  }

  if (githubEvent === "pull_request") {
    return await handlePullRequestWebhookEvent({
      api,
      store,
      payload: payload as GitHubPullRequestWebhookEvent,
      repoConfig: matchingRepo,
      binding,
      respondJson,
    });
  }

  if (githubEvent === "pull_request_review") {
    return await handlePullRequestReviewWebhookEvent({
      api,
      store,
      payload: payload as GitHubPullRequestReviewWebhookEvent,
      repoConfig: matchingRepo,
      binding,
      respondJson,
    });
  }

  return await respondJson({
    accepted: false,
    reason: "ignored-event",
  });
}

async function processNextQueuedRun(
  api: OpenClawPluginApi,
  store: OpenClawCodeChatopsStore,
): Promise<void> {
  if (workerActive) {
    return;
  }
  const next = await store.startNext();
  if (!next) {
    return;
  }

  workerActive = true;
  try {
    await sendText({
      api,
      channel: next.notifyChannel,
      target: next.notifyTarget,
      text: `openclawcode is starting ${next.issueKey}.`,
    });

    const argv = buildOpenClawCodeRunArgv(next.request);
    const result = await api.runtime.system.runCommandWithTimeout(argv, {
      cwd: next.request.repoRoot,
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      noOutputTimeoutMs: 10 * 60_000,
    });

    if (result.code !== 0) {
      const failure = summarizeFailure(result.stderr, result.stdout);
      await store.finishCurrent(next.issueKey, `Failed.\n${failure}`);
      await sendText({
        api,
        channel: next.notifyChannel,
        target: next.notifyTarget,
        text: `openclawcode failed on ${next.issueKey}.\n${failure}`,
      });
      return;
    }

    const run = extractWorkflowRunFromCommandOutput(result.stdout);
    if (!run) {
      await store.finishCurrent(next.issueKey, "Completed, but workflow JSON could not be parsed.");
      await sendText({
        api,
        channel: next.notifyChannel,
        target: next.notifyTarget,
        text: `openclawcode finished ${next.issueKey}, but could not parse the workflow JSON output.`,
      });
      return;
    }

    const statusMessage = buildRunStatusMessage(run);
    await store.finishCurrent(next.issueKey, statusMessage);
    await store.recordWorkflowRunStatus(run, statusMessage, {
      notifyChannel: next.notifyChannel,
      notifyTarget: next.notifyTarget,
    });
    await sendText({
      api,
      channel: next.notifyChannel,
      target: next.notifyTarget,
      text: statusMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishCurrent(next.issueKey, `Failed.\n${message}`);
    await sendText({
      api,
      channel: next.notifyChannel,
      target: next.notifyTarget,
      text: `openclawcode failed on ${next.issueKey}.\n${message}`,
    }).catch(() => undefined);
  } finally {
    workerActive = false;
  }
}

export default {
  id: "openclawcode",
  name: "OpenClawCode",
  description: "GitHub issue chatops adapter for the openclawcode workflow.",
  register(api: OpenClawPluginApi) {
    const store = OpenClawCodeChatopsStore.fromStateDir(api.runtime.state.resolveStateDir());

    api.registerHttpRoute({
      path: "/plugins/openclawcode/github",
      auth: "plugin",
      handler: async (req, res) => await handleGithubWebhook(api, store, req, res),
    });

    api.registerCommand({
      name: "occode-start",
      description: "Queue an openclawcode issue run.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsCommand(`/occode-start ${ctx.args ?? ""}`, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text:
              "Usage: /occode-start owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-start #123",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, command.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${command.issue.owner}/${command.issue.repo}.`,
          };
        }

        const issueKey = formatIssueKey({
          owner: command.issue.owner,
          repo: command.issue.repo,
          number: command.issue.number,
        });
        const currentStatus = await store.getStatus(issueKey);
        const pendingApproval = await store.getPendingApproval(issueKey);
        if (await store.isQueuedOrRunning(issueKey)) {
          return { text: `${issueKey} is already in progress.\n${currentStatus ?? "Queued."}` };
        }

        const request = buildRunRequestFromCommand({
          command,
          config: repoConfig,
        });
        const notifyTarget =
          resolveCommandNotifyTarget(ctx) ||
          ctx.senderId?.trim() ||
          pendingApproval?.notifyTarget ||
          repoConfig.notifyTarget;
        const queuedRun = await store.promotePendingApprovalToQueue({
          issueKey,
          request,
          fallbackNotifyChannel: pendingApproval?.notifyChannel ?? repoConfig.notifyChannel,
          fallbackNotifyTarget: notifyTarget,
          status: pendingApproval ? "Approved in chat and queued." : "Queued.",
        });
        if (!queuedRun) {
          return { text: `${issueKey} is already queued or running.` };
        }

        return { text: `Queued ${issueKey}. I will post status updates here.` };
      },
    });

    api.registerCommand({
      name: "occode-bind",
      description: "Bind the current chat as the notification target for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-bind owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-bind",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const notifyTarget = resolveCommandNotifyTarget(ctx);
        if (!notifyTarget) {
          return {
            text: "This chat session did not expose a reply target, so I could not save a binding.",
          };
        }

        const binding = await store.setRepoBinding({
          repoKey: formatRepoKey(repo),
          notifyChannel: ctx.channel?.trim() || repoConfig.notifyChannel,
          notifyTarget,
        });
        return {
          text: [
            `Bound ${binding.repoKey} notifications to this chat.`,
            `Channel: ${binding.notifyChannel}`,
            `Target: ${binding.notifyTarget}`,
          ].join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-unbind",
      description: "Remove the saved notification target binding for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-unbind owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-unbind",
          };
        }

        const repoKey = formatRepoKey(repo);
        return (await store.removeRepoBinding(repoKey))
          ? { text: `Removed notification binding for ${repoKey}.` }
          : { text: `No saved notification binding found for ${repoKey}.` };
      },
    });

    api.registerCommand({
      name: "occode-status",
      description: "Show the latest known openclawcode issue status.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsCommand(`/occode-status ${ctx.args ?? ""}`, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text:
              "Usage: /occode-status owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-status #123",
          };
        }

        const issueKey = formatIssueKey({
          owner: command.issue.owner,
          repo: command.issue.repo,
          number: command.issue.number,
        });
        const repoConfig = resolveRepoConfig(pluginConfig.repos, command.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${command.issue.owner}/${command.issue.repo}.`,
          };
        }
        if (await store.isPendingApproval(issueKey)) {
          return {
            text: (await store.getStatus(issueKey)) ?? `Awaiting chat approval for ${issueKey}.`,
          };
        }
        const currentSnapshot = await store.getStatusSnapshot(issueKey);
        if (currentSnapshot) {
          try {
            const synced = await syncIssueSnapshotFromGitHub({
              snapshot: currentSnapshot,
            });
            if (synced.changed) {
              await store.setStatusSnapshot(synced.snapshot);
              return { text: synced.snapshot.status };
            }
          } catch {
            // Keep /occode-status usable even if GitHub is temporarily unavailable.
          }
        }
        const currentStatus = await store.getStatus(issueKey);
        if (currentStatus) {
          return { text: currentStatus };
        }
        const reconciled = await findLatestLocalRunStatusForIssue({
          repo: repoConfig,
          issueKey,
        });
        return {
          text: reconciled?.status ?? `No openclawcode status recorded yet for ${issueKey}.`,
        };
      },
    });

    api.registerCommand({
      name: "occode-inbox",
      description:
        "Show pending approvals, queue state, and recent activity for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-inbox owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-inbox",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const state = await store.snapshot();
        return {
          text: buildInboxMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            state,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-skip",
      description: "Remove a queued openclawcode issue run before execution starts.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsCommand(`/occode-skip ${ctx.args ?? ""}`, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text:
              "Usage: /occode-skip owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-skip #123",
          };
        }

        const issueKey = formatIssueKey({
          owner: command.issue.owner,
          repo: command.issue.repo,
          number: command.issue.number,
        });
        if (await store.removePendingApproval(issueKey)) {
          return { text: `Skipped pending approval for ${issueKey}.` };
        }
        return (await store.removeQueued(issueKey))
          ? { text: `Skipped queued run for ${issueKey}.` }
          : { text: `No pending or queued run found for ${issueKey}.` };
      },
    });

    api.registerCommand({
      name: "occode-sync",
      description: "Reconcile local run records and GitHub status for tracked issues.",
      acceptsArgs: false,
      handler: async () => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        await reconcileLocalRunStatuses({
          store,
          repoConfigs: pluginConfig.repos,
        });
        const result = await syncSnapshotsFromGitHub(store);
        return {
          text: [
            "openclawcode sync complete.",
            `Tracked snapshots checked: ${result.checked}`,
            `Statuses healed: ${result.changed}`,
            result.failed > 0
              ? `GitHub sync failures: ${result.failed}`
              : "GitHub sync failures: 0",
          ].join("\n"),
        };
      },
    });

    api.registerService({
      id: "openclawcode-runner",
      start: async () => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const intervalMs = pluginConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        await store.recoverInterruptedRun();
        await reconcileLocalRunStatuses({
          store,
          repoConfigs: pluginConfig.repos,
        });
        pollTimer = setInterval(() => {
          void processNextQueuedRun(api, store);
        }, intervalMs);
        pollTimer.unref?.();
      },
      stop: async () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      },
    });
  },
};
