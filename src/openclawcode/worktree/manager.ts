import fs from "node:fs/promises";
import path from "node:path";

import { execFileUtf8 } from "../../daemon/exec-file.js";
import type { WorkflowWorkspace } from "../contracts/index.js";

export interface PrepareWorkspaceParams {
  repoRoot: string;
  worktreeRoot: string;
  branchName: string;
  baseBranch: string;
  runId: string;
}

export interface WorkflowWorkspaceManager {
  prepare(params: PrepareWorkspaceParams): Promise<WorkflowWorkspace>;
  collectChangedFiles(workspace: WorkflowWorkspace): Promise<string[]>;
  cleanup(workspace: WorkflowWorkspace): Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileUtf8("git", ["-C", cwd, ...args]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export class GitWorktreeManager implements WorkflowWorkspaceManager {
  constructor(private readonly now: () => string = nowIso) {}

  private resolveWorktreePath(params: PrepareWorkspaceParams): string {
    return path.join(params.worktreeRoot, sanitizePathSegment(params.runId));
  }

  async prepare(params: PrepareWorkspaceParams): Promise<WorkflowWorkspace> {
    const worktreePath = this.resolveWorktreePath(params);

    await fs.mkdir(params.worktreeRoot, { recursive: true });

    if (!(await pathExists(worktreePath))) {
      const branchExists =
        (await execFileUtf8("git", [
          "-C",
          params.repoRoot,
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${params.branchName}`
        ])).code === 0;

      const args = branchExists
        ? ["-C", params.repoRoot, "worktree", "add", worktreePath, params.branchName]
        : [
            "-C",
            params.repoRoot,
            "worktree",
            "add",
            "-b",
            params.branchName,
            worktreePath,
            params.baseBranch
          ];

      const result = await execFileUtf8("git", args);
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to prepare worktree at ${worktreePath}`);
      }
    }

    return {
      repoRoot: params.repoRoot,
      baseBranch: params.baseBranch,
      branchName: params.branchName,
      worktreePath,
      preparedAt: this.now()
    };
  }

  async collectChangedFiles(workspace: WorkflowWorkspace): Promise<string[]> {
    const trackedFromBase = await runGit(workspace.worktreePath, [
      "diff",
      "--name-only",
      "--relative",
      `${workspace.baseBranch}...HEAD`
    ]);
    const trackedFromWorktree = await runGit(workspace.worktreePath, [
      "diff",
      "--name-only",
      "--relative",
      "HEAD"
    ]);
    const untracked = await runGit(workspace.worktreePath, [
      "ls-files",
      "--others",
      "--exclude-standard"
    ]);

    return Array.from(
      new Set(
        [...trackedFromBase.split("\n"), ...trackedFromWorktree.split("\n"), ...untracked.split("\n")]
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    ).sort();
  }

  async cleanup(workspace: WorkflowWorkspace): Promise<void> {
    const remove = await execFileUtf8("git", [
      "-C",
      workspace.repoRoot,
      "worktree",
      "remove",
      "--force",
      workspace.worktreePath
    ]);
    if (remove.code !== 0) {
      throw new Error(remove.stderr || `Failed to remove worktree ${workspace.worktreePath}`);
    }

    const prune = await execFileUtf8("git", ["-C", workspace.repoRoot, "worktree", "prune"]);
    if (prune.code !== 0) {
      throw new Error(prune.stderr || `Failed to prune worktrees for ${workspace.repoRoot}`);
    }
  }
}
