import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import { GitWorktreeManager } from "../worktree/index.js";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileUtf8("git", ["-C", cwd, ...args]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

async function createTempRepo(): Promise<{ rootDir: string; worktreeRoot: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-repo-"));
  const worktreeRoot = path.join(rootDir, ".openclawcode-worktrees");

  await runGit(rootDir, ["init"]);
  await runGit(rootDir, ["config", "user.name", "OpenClaw Code Tests"]);
  await runGit(rootDir, ["config", "user.email", "tests@openclawcode.local"]);

  await fs.writeFile(path.join(rootDir, "README.md"), "# temp repo\n", "utf8");
  await runGit(rootDir, ["add", "README.md"]);
  await runGit(rootDir, ["commit", "-m", "init"]);
  await runGit(rootDir, ["branch", "-M", "main"]);

  await fs.mkdir(path.join(rootDir, "node_modules", ".bin"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "node_modules", ".bin", "vitest"), "#!/bin/sh\n", "utf8");

  return { rootDir, worktreeRoot };
}

describe("GitWorktreeManager", () => {
  it("creates and reuses a per-run worktree", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-42",
        baseBranch: "main",
        runId: "issue-42",
      });
      const second = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-42",
        baseBranch: "main",
        runId: "issue-42",
      });

      expect(first.worktreePath).toBe(second.worktreePath);
      expect(await fs.readFile(path.join(first.worktreePath, "README.md"), "utf8")).toContain(
        "temp repo",
      );
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("reuses an existing issue branch worktree across reruns", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-45",
        baseBranch: "main",
        runId: "issue-45-first",
      });
      const second = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-45",
        baseBranch: "main",
        runId: "issue-45-second",
      });

      expect(second.worktreePath).toBe(first.worktreePath);
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("links shared install artifacts into the worktree", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const workspace = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-46",
        baseBranch: "main",
        runId: "issue-46",
      });

      const nodeModulesStat = await fs.lstat(path.join(workspace.worktreePath, "node_modules"));
      expect(nodeModulesStat.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(path.join(workspace.worktreePath, "node_modules"))).toBe(
        path.join(repo.rootDir, "node_modules"),
      );
      expect(
        await fs.readFile(
          path.join(workspace.worktreePath, "node_modules", ".bin", "vitest"),
          "utf8",
        ),
      ).toContain("#!/bin/sh");
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("collects tracked and untracked file changes from the isolated worktree", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const workspace = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-43",
        baseBranch: "main",
        runId: "issue-43",
      });

      await fs.writeFile(path.join(workspace.worktreePath, "README.md"), "# changed\n", "utf8");
      await fs.writeFile(path.join(workspace.worktreePath, "notes.txt"), "hello\n", "utf8");
      await fs.writeFile(path.join(workspace.worktreePath, "HEARTBEAT.md"), "runtime\n", "utf8");
      await fs.mkdir(path.join(workspace.worktreePath, ".openclaw"), { recursive: true });
      await fs.writeFile(
        path.join(workspace.worktreePath, ".openclaw", "session.json"),
        "{}\n",
        "utf8",
      );

      expect(await manager.collectChangedFiles(workspace)).toEqual(["README.md", "notes.txt"]);
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("removes the worktree during cleanup", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const workspace = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-44",
        baseBranch: "main",
        runId: "issue-44",
      });

      await manager.cleanup(workspace);

      await expect(fs.stat(workspace.worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });
});
