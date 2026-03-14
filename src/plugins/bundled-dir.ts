import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";
import { resolveUserPath } from "../utils.js";

export type BundledPluginsResolveOptions = {
  argv1?: string;
  moduleUrl?: string;
  cwd?: string;
  execPath?: string;
};

export function resolveBundledPluginsDir(
  env: NodeJS.ProcessEnv = process.env,
  opts: BundledPluginsResolveOptions = {},
): string | undefined {
  const override = env.OPENCLAW_BUNDLED_PLUGINS_DIR?.trim();
  if (override) {
    return resolveUserPath(override, env);
  }

  // bun --compile: ship a sibling `extensions/` next to the executable.
  try {
    const execDir = path.dirname(opts.execPath ?? process.execPath);
    const sibling = path.join(execDir, "extensions");
    if (fs.existsSync(sibling)) {
      return sibling;
    }
  } catch {
    // ignore
  }

  // npm/dev: resolve `<packageRoot>/extensions` first so a partial `dist/extensions`
  // directory does not shadow the full bundled tree at the package root.
  try {
    const moduleUrl = opts.moduleUrl ?? import.meta.url;
    const argv1 = opts.argv1 ?? process.argv[1];
    const cwd = opts.cwd ?? process.cwd();
    const packageRoot = resolveOpenClawPackageRootSync({
      argv1,
      moduleUrl,
      cwd,
    });
    if (packageRoot) {
      const candidate = path.join(packageRoot, "extensions");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    let cursor = path.dirname(fileURLToPath(moduleUrl));
    for (let i = 0; i < 6; i += 1) {
      const candidate = path.join(cursor, "extensions");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {
    // ignore
  }

  return undefined;
}
