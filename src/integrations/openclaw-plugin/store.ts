import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawCodeChatopsRunRequest } from "./chatops.js";

export interface OpenClawCodeQueuedRun {
  request: OpenClawCodeChatopsRunRequest;
  notifyChannel: string;
  notifyTarget: string;
  issueKey: string;
}

interface OpenClawCodeQueueState {
  version: 1;
  queue: OpenClawCodeQueuedRun[];
  currentRun?: OpenClawCodeQueuedRun;
  statusByIssue: Record<string, string>;
}

function cloneDefaultState(): OpenClawCodeQueueState {
  return {
    version: 1,
    queue: [],
    statusByIssue: {},
  };
}

function normalizeState(raw: unknown): OpenClawCodeQueueState {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultState();
  }
  const candidate = raw as Partial<OpenClawCodeQueueState>;
  return {
    version: 1,
    queue: Array.isArray(candidate.queue) ? candidate.queue : [],
    currentRun:
      candidate.currentRun && typeof candidate.currentRun === "object"
        ? candidate.currentRun
        : undefined,
    statusByIssue:
      candidate.statusByIssue && typeof candidate.statusByIssue === "object"
        ? candidate.statusByIssue
        : {},
  };
}

export class OpenClawCodeChatopsStore {
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

  private async saveState(state: OpenClawCodeQueueState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.statePath);
  }

  async getStatus(issueKey: string): Promise<string | undefined> {
    const state = await this.loadState();
    return state.statusByIssue[issueKey];
  }

  async setStatus(issueKey: string, status: string): Promise<void> {
    const state = await this.loadState();
    state.statusByIssue[issueKey] = status;
    await this.saveState(state);
  }

  async isQueuedOrRunning(issueKey: string): Promise<boolean> {
    const state = await this.loadState();
    return (
      state.currentRun?.issueKey === issueKey ||
      state.queue.some((entry) => entry.issueKey === issueKey)
    );
  }

  async enqueue(run: OpenClawCodeQueuedRun, status = "Queued."): Promise<boolean> {
    const state = await this.loadState();
    if (
      state.currentRun?.issueKey === run.issueKey ||
      state.queue.some((entry) => entry.issueKey === run.issueKey)
    ) {
      return false;
    }
    state.queue.push(run);
    state.statusByIssue[run.issueKey] = status;
    await this.saveState(state);
    return true;
  }

  async removeQueued(issueKey: string, status = "Skipped before execution."): Promise<boolean> {
    const state = await this.loadState();
    const index = state.queue.findIndex((entry) => entry.issueKey === issueKey);
    if (index < 0) {
      return false;
    }
    state.queue.splice(index, 1);
    state.statusByIssue[issueKey] = status;
    await this.saveState(state);
    return true;
  }

  async startNext(status = "Running."): Promise<OpenClawCodeQueuedRun | undefined> {
    const state = await this.loadState();
    if (state.currentRun) {
      return undefined;
    }
    const next = state.queue.shift();
    if (!next) {
      return undefined;
    }
    state.currentRun = next;
    state.statusByIssue[next.issueKey] = status;
    await this.saveState(state);
    return next;
  }

  async finishCurrent(issueKey: string, status: string): Promise<void> {
    const state = await this.loadState();
    if (state.currentRun?.issueKey === issueKey) {
      state.currentRun = undefined;
    }
    state.statusByIssue[issueKey] = status;
    await this.saveState(state);
  }

  async recoverInterruptedRun(
    status = "Recovered after restart; waiting to resume.",
  ): Promise<OpenClawCodeQueuedRun | undefined> {
    const state = await this.loadState();
    const current = state.currentRun;
    if (!current) {
      return undefined;
    }
    state.currentRun = undefined;
    if (!state.queue.some((entry) => entry.issueKey === current.issueKey)) {
      state.queue.unshift(current);
    }
    state.statusByIssue[current.issueKey] = status;
    await this.saveState(state);
    return current;
  }

  async snapshot(): Promise<OpenClawCodeQueueState> {
    return await this.loadState();
  }
}
