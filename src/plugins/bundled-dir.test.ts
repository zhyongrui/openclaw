import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { resolveBundledPluginsDir } from "./bundled-dir.js";

describe("resolveBundledPluginsDir", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["OPENCLAW_BUNDLED_PLUGINS_DIR"]);
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("returns OPENCLAW_BUNDLED_PLUGINS_DIR override when set", async () => {
    const overrideDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bundled-plugins-"));
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = ` ${overrideDir} `;
    expect(resolveBundledPluginsDir()).toBe(overrideDir);
  });

  it("prefers packageRoot/extensions over dist/extensions in a built layout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bundled-plugins-"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    const bundledRoot = path.join(root, "extensions");
    const distBundledRoot = path.join(root, "dist", "extensions");
    await fs.mkdir(path.join(bundledRoot, "memory-core"), { recursive: true });
    await fs.mkdir(path.join(distBundledRoot, "openclawcode"), { recursive: true });
    await fs.writeFile(
      path.join(bundledRoot, "memory-core", "openclaw.plugin.json"),
      '{"id":"memory-core"}\n',
    );
    await fs.writeFile(
      path.join(distBundledRoot, "openclawcode", "openclaw.plugin.json"),
      '{"id":"openclawcode"}\n',
    );

    const resolved = resolveBundledPluginsDir(process.env, {
      argv1: path.join(root, "dist", "index.js"),
      moduleUrl: pathToFileURL(path.join(root, "dist", "plugins", "bundled-dir.js")).href,
      cwd: path.join(root, "dist"),
      execPath: path.join(root, "bin", "node"),
    });

    expect(resolved).toBe(bundledRoot);
  });
});
