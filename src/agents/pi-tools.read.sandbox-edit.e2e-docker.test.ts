import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSandboxedEditTool } from "./pi-tools.read.js";
import { DEFAULT_SANDBOX_IMAGE } from "./sandbox/constants.js";
import { buildSandboxCreateArgs, execDocker, execDockerRaw } from "./sandbox/docker.js";
import { createSandboxFsBridge } from "./sandbox/fs-bridge.js";
import { createSandboxTestContext } from "./sandbox/test-fixtures.js";
import { appendWorkspaceMountArgs } from "./sandbox/workspace-mounts.js";

async function sandboxImageReady(): Promise<boolean> {
  try {
    const dockerVersion = await execDockerRaw(["version"], { allowFailure: true });
    if (dockerVersion.code !== 0) {
      return false;
    }
    const pythonCheck = await execDockerRaw(
      ["run", "--rm", "--entrypoint", "python3", DEFAULT_SANDBOX_IMAGE, "--version"],
      { allowFailure: true },
    );
    return pythonCheck.code === 0;
  } catch {
    return false;
  }
}

describe("createSandboxedEditTool docker e2e", () => {
  it.runIf(process.platform !== "win32")(
    "edits a workspace file through the sandbox bridge using alias-style edit params",
    async () => {
      if (!(await sandboxImageReady())) {
        return;
      }

      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-e2e-"));
      const workspaceDir = path.join(stateDir, "workspace");
      const targetRelativePath = path.join("src", "commands", "openclawcode.test.ts");
      const targetPath = path.join(workspaceDir, targetRelativePath);

      const original = [
        'import { describe, it, expect } from "vitest";',
        "",
        'describe("demo", () => {',
        '  it("reports false when rerun context does not include review metadata", async () => {',
        "    expect(true).toBe(true);",
        "  });",
        "",
        '  it("keeps unpublished local draft metadata separate from published pr fields", async () => {',
        "    expect(true).toBe(true);",
        "  });",
        "});",
        "",
      ].join("\n");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, original, "utf8");

      const suffix = `${process.pid}-${Date.now()}`;
      const containerName = `openclaw-sbx-edit-${suffix}`.slice(0, 63);

      try {
        const sandbox = createSandboxTestContext({
          overrides: {
            workspaceDir,
            agentWorkspaceDir: workspaceDir,
            containerName,
            containerWorkdir: "/workspace",
          },
          dockerOverrides: {
            image: DEFAULT_SANDBOX_IMAGE,
            containerPrefix: "openclaw-sbx-edit-",
            user: "",
          },
        });

        const createArgs = buildSandboxCreateArgs({
          name: containerName,
          cfg: sandbox.docker,
          scopeKey: sandbox.sessionKey,
          includeBinds: false,
          bindSourceRoots: [workspaceDir],
        });
        createArgs.push("--workdir", sandbox.containerWorkdir);
        appendWorkspaceMountArgs({
          args: createArgs,
          workspaceDir,
          agentWorkspaceDir: workspaceDir,
          workdir: sandbox.containerWorkdir,
          workspaceAccess: sandbox.workspaceAccess,
        });
        createArgs.push(sandbox.docker.image, "sleep", "infinity");

        await execDocker(createArgs);
        await execDocker(["start", containerName]);

        const bridge = createSandboxFsBridge({ sandbox });
        const tool = createSandboxedEditTool({
          root: workspaceDir,
          bridge,
        });

        const oldText = [
          '  it("reports false when rerun context does not include review metadata", async () => {',
          "    expect(true).toBe(true);",
          "  });",
          "",
          '  it("keeps unpublished local draft metadata separate from published pr fields", async () => {',
        ].join("\n");
        const newText = [
          '  it("reports false when rerun context does not include review metadata", async () => {',
          "    expect(true).toBe(true);",
          "  });",
          "",
          '  it("reports false rerun JSON fields when rerun context is absent", async () => {',
          "    expect(true).toBe(true);",
          "  });",
          "",
          '  it("keeps unpublished local draft metadata separate from published pr fields", async () => {',
        ].join("\n");

        const result = await tool.execute(
          "call-1",
          {
            file_path: targetRelativePath.split(path.sep).join(path.posix.sep),
            old_string: oldText,
            new_string: newText,
          },
          undefined,
        );

        const final = await fs.readFile(targetPath, "utf8");
        expect(final).toContain("reports false rerun JSON fields when rerun context is absent");
        expect(final.length).toBeGreaterThan(original.length);

        const content = Array.isArray((result as { content?: unknown }).content)
          ? (result as { content: Array<{ type?: string; text?: string }> }).content
          : [];
        expect(content.find((entry) => entry?.type === "text")?.text).toContain(
          "Successfully replaced text",
        );
      } finally {
        await execDocker(["rm", "-f", containerName], { allowFailure: true });
        await fs.rm(stateDir, { recursive: true, force: true });
      }
    },
  );
});
