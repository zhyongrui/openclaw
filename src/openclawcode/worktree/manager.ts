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

const RUNTIME_ARTIFACT_RULES = [".openclaw/", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"];
const SHARED_INSTALL_ARTIFACTS = ["node_modules"];

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

type GitWorktreeEntry = {
  path: string;
  branch?: string;
};

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

async function listGitWorktrees(repoRoot: string): Promise<GitWorktreeEntry[]> {
  const output = await runGit(repoRoot, ["worktree", "list", "--porcelain"]);
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | undefined;

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      if (current?.path) {
        entries.push(current);
      }
      current = undefined;
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current?.path) {
        entries.push(current);
      }
      current = { path: line.slice("worktree ".length).trim() };
      continue;
    }

    if (line.startsWith("branch ")) {
      current ??= { path: "" };
      current.branch = line.slice("branch ".length).trim();
    }
  }

  if (current?.path) {
    entries.push(current);
  }

  return entries;
}

function shouldIgnoreChangedFile(file: string): boolean {
  const ignoredRules = [...RUNTIME_ARTIFACT_RULES, ...SHARED_INSTALL_ARTIFACTS];
  return ignoredRules.some((rule) => (rule.endsWith("/") ? file.startsWith(rule) : file === rule));
}

async function ensureSharedInstallArtifacts(repoRoot: string, worktreePath: string): Promise<void> {
  for (const relativePath of SHARED_INSTALL_ARTIFACTS) {
    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(worktreePath, relativePath);

    if (!(await pathExists(sourcePath)) || (await pathExists(targetPath))) {
      continue;
    }

    await fs.symlink(sourcePath, targetPath, "dir");
  }
}

export class GitWorktreeManager implements WorkflowWorkspaceManager {
  constructor(private readonly now: () => string = nowIso) {}

  private resolveWorktreePath(params: PrepareWorkspaceParams): string {
    return path.join(params.worktreeRoot, sanitizePathSegment(params.runId));
  }

  async prepare(params: PrepareWorkspaceParams): Promise<WorkflowWorkspace> {
    const worktreePath = this.resolveWorktreePath(params);
    const branchRef = `refs/heads/${params.branchName}`;

    await fs.mkdir(params.worktreeRoot, { recursive: true });

    if (!(await pathExists(worktreePath))) {
      await runGit(params.repoRoot, ["worktree", "prune"]);

      const existingBranchWorktree = (await listGitWorktrees(params.repoRoot)).find(
        (entry) => entry.branch === branchRef,
      );
      if (existingBranchWorktree && (await pathExists(existingBranchWorktree.path))) {
        await ensureSharedInstallArtifacts(params.repoRoot, existingBranchWorktree.path);
        return {
          repoRoot: params.repoRoot,
          baseBranch: params.baseBranch,
          branchName: params.branchName,
          worktreePath: existingBranchWorktree.path,
          preparedAt: this.now(),
        };
      }

      const branchExists =
        (
          await execFileUtf8("git", [
            "-C",
            params.repoRoot,
            "show-ref",
            "--verify",
            "--quiet",
            branchRef,
          ])
        ).code === 0;

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
            params.baseBranch,
          ];

      const result = await execFileUtf8("git", args);
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to prepare worktree at ${worktreePath}`);
      }
    }

    await ensureSharedInstallArtifacts(params.repoRoot, worktreePath);

    return {
      repoRoot: params.repoRoot,
      baseBranch: params.baseBranch,
      branchName: params.branchName,
      worktreePath,
      preparedAt: this.now(),
    };
  }

  async collectChangedFiles(workspace: WorkflowWorkspace): Promise<string[]> {
    const trackedFromBase = await runGit(workspace.worktreePath, [
      "diff",
      "--name-only",
      "--relative",
      `${workspace.baseBranch}...HEAD`,
    ]);
    const trackedFromWorktree = await runGit(workspace.worktreePath, [
      "diff",
      "--name-only",
      "--relative",
      "HEAD",
    ]);
    const untracked = await runGit(workspace.worktreePath, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);

    return Array.from(
      new Set(
        [
          ...trackedFromBase.split("\n"),
          ...trackedFromWorktree.split("\n"),
          ...untracked.split("\n"),
        ]
          .map((entry) => entry.trim())
          .filter(Boolean)
          .filter((entry) => !shouldIgnoreChangedFile(entry)),
      ),
    ).toSorted();
  }

  async cleanup(workspace: WorkflowWorkspace): Promise<void> {
    const remove = await execFileUtf8("git", [
      "-C",
      workspace.repoRoot,
      "worktree",
      "remove",
      "--force",
      workspace.worktreePath,
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
