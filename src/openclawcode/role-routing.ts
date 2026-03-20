import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_BLUEPRINT_ROLE_IDS,
  readProjectBlueprintDocument,
  type ProjectBlueprintRoleId,
} from "./blueprint.js";

export const PROJECT_ROLE_ROUTING_SCHEMA_VERSION = 1;
export const PROJECT_ROLE_ADAPTER_IDS = [
  "codex",
  "claude-code",
  "openclaw-default",
  "custom",
] as const;

export type ProjectRoleAdapterId = (typeof PROJECT_ROLE_ADAPTER_IDS)[number];

export interface ProjectRoleRoute {
  roleId: ProjectBlueprintRoleId;
  rawAssignment: string | null;
  adapterId: ProjectRoleAdapterId;
  source: "blueprint" | "env-role-default" | "openclaw-default";
  configured: boolean;
  fallbackChain: string[];
  runtimeCapable: boolean;
  rerouteCapable: boolean;
  resolvedBackend: string;
  resolvedAgentId: string | null;
  appliedSource: "blueprint" | "env-role-default" | "openclaw-default";
}

export interface ProjectRoleRoutingPlan {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  fallbackChain: string[];
  fallbackConfigured: boolean;
  mixedMode: boolean;
  routeCount: number;
  unresolvedRoleCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
  routes: ProjectRoleRoute[];
}

function resolveProjectRoleRoutingArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "role-routing.json");
}

function normalizeRoleAdapter(raw: string | null): ProjectRoleAdapterId {
  const normalized = raw?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "openclaw-default";
  }
  if (normalized === "codex" || normalized === "openai-codex" || normalized === "openai codex") {
    return "codex";
  }
  if (normalized === "claude-code" || normalized === "claude code" || normalized === "claude") {
    return "claude-code";
  }
  return "custom";
}

function resolveRoleEnvVar(roleId: ProjectBlueprintRoleId): string {
  switch (roleId) {
    case "planner":
      return "OPENCLAWCODE_ROLE_PLANNER";
    case "coder":
      return "OPENCLAWCODE_ROLE_CODER";
    case "reviewer":
      return "OPENCLAWCODE_ROLE_REVIEWER";
    case "verifier":
      return "OPENCLAWCODE_ROLE_VERIFIER";
    case "docWriter":
      return "OPENCLAWCODE_ROLE_DOC_WRITER";
  }
}

function resolveRoleAgentEnvVar(roleId: ProjectBlueprintRoleId): string | null {
  switch (roleId) {
    case "coder":
      return "OPENCLAWCODE_ROLE_CODER_AGENT_ID";
    case "verifier":
      return "OPENCLAWCODE_ROLE_VERIFIER_AGENT_ID";
    default:
      return null;
  }
}

function resolveAdapterAgentEnvVar(adapterId: ProjectRoleAdapterId): string | null {
  switch (adapterId) {
    case "codex":
      return "OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID";
    case "claude-code":
      return "OPENCLAWCODE_ADAPTER_CLAUDE_CODE_AGENT_ID";
    case "openclaw-default":
      return "OPENCLAWCODE_ADAPTER_OPENCLAW_DEFAULT_AGENT_ID";
    case "custom":
      return "OPENCLAWCODE_ADAPTER_CUSTOM_AGENT_ID";
    default:
      return null;
  }
}

function resolveRoleLabel(roleId: ProjectBlueprintRoleId): string {
  switch (roleId) {
    case "planner":
      return "planner";
    case "coder":
      return "coder";
    case "reviewer":
      return "reviewer";
    case "verifier":
      return "verifier";
    case "docWriter":
      return "doc-writer";
  }
}

function resolveFallbackChain(): string[] {
  const raw = process.env.OPENCLAWCODE_MODEL_FALLBACKS?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveRouteAssignment(params: {
  roleId: ProjectBlueprintRoleId;
  blueprintAssignments: ProjectBlueprintRoleAssignments;
}): { rawAssignment: string | null; source: ProjectRoleRoute["source"] } {
  const fromBlueprint = params.blueprintAssignments[params.roleId];
  if (fromBlueprint && fromBlueprint.trim().length > 0) {
    return {
      rawAssignment: fromBlueprint.trim(),
      source: "blueprint",
    };
  }

  const roleEnvValue = process.env[resolveRoleEnvVar(params.roleId)]?.trim();
  if (roleEnvValue) {
    return {
      rawAssignment: roleEnvValue,
      source: "env-role-default",
    };
  }

  const defaultValue = process.env.OPENCLAWCODE_ROLE_DEFAULT?.trim() ?? null;
  return {
    rawAssignment: defaultValue && defaultValue.length > 0 ? defaultValue : null,
    source: defaultValue ? "env-role-default" : "openclaw-default",
  };
}

function emptyProjectRoleRoutingPlan(params: {
  repoRoot: string;
  artifactPath: string;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  fallbackChain: string[];
}): ProjectRoleRoutingPlan {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    fallbackChain: params.fallbackChain,
    fallbackConfigured: params.fallbackChain.length > 0,
    mixedMode: false,
    routeCount: 0,
    unresolvedRoleCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
    routes: [],
  };
}

export async function deriveProjectRoleRoutingPlan(
  repoRootInput: string,
): Promise<ProjectRoleRoutingPlan> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectRoleRoutingArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const fallbackChain = resolveFallbackChain();

  if (!blueprint.exists) {
    return emptyProjectRoleRoutingPlan({
      repoRoot,
      artifactPath,
      blueprintExists: false,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: null,
      fallbackChain,
    });
  }

  const routes = PROJECT_BLUEPRINT_ROLE_IDS.map((roleId) => {
    const assignment = resolveRouteAssignment({
      roleId,
      blueprintAssignments: blueprint.providerRoleAssignments,
    });
    const adapterId = normalizeRoleAdapter(assignment.rawAssignment);
    const roleAgentEnvVar = resolveRoleAgentEnvVar(roleId);
    const adapterAgentEnvVar = resolveAdapterAgentEnvVar(adapterId);
    const resolvedAgentId =
      process.env[roleAgentEnvVar ?? ""]?.trim() ||
      process.env[adapterAgentEnvVar ?? ""]?.trim() ||
      null;
    return {
      roleId,
      rawAssignment: assignment.rawAssignment,
      adapterId,
      source: assignment.source,
      configured: assignment.rawAssignment != null && assignment.rawAssignment.length > 0,
      fallbackChain,
      runtimeCapable: roleId === "coder" || roleId === "verifier",
      rerouteCapable: roleId === "coder" || roleId === "verifier",
      resolvedBackend: assignment.rawAssignment?.trim() || adapterId,
      resolvedAgentId,
      appliedSource: assignment.source,
    };
  });

  const unresolvedRoles = routes.filter((route) => !route.configured);
  const adapterSet = new Set(
    routes
      .filter((route) => route.configured)
      .map((route) => route.adapterId)
      .filter((adapter) => adapter !== "openclaw-default"),
  );
  const blockers =
    unresolvedRoles.length > 0
      ? [
          `Assign providers for the unresolved roles: ${unresolvedRoles
            .map((route) => resolveRoleLabel(route.roleId))
            .join(", ")}.`,
        ]
      : [];
  const suggestions = [
    fallbackChain.length > 0
      ? "A fallback chain is configured; keep it consistent with the primary role assignments."
      : "Consider setting `OPENCLAWCODE_MODEL_FALLBACKS` once a second model is available for proofs.",
    adapterSet.size > 1
      ? "Mixed-mode routing is active; verify each role/provider pairing in a real proof."
      : "If you want planner/coder separation, assign at least one role to Codex and another to Claude Code.",
  ];

  return {
    repoRoot,
    artifactPath,
    exists: false,
    schemaVersion: PROJECT_ROLE_ROUTING_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    blueprintExists: true,
    blueprintPath: blueprint.blueprintPath,
    blueprintRevisionId: blueprint.revisionId,
    fallbackChain,
    fallbackConfigured: fallbackChain.length > 0,
    mixedMode: adapterSet.size > 1,
    routeCount: routes.length,
    unresolvedRoleCount: unresolvedRoles.length,
    blockers,
    suggestionCount: suggestions.length,
    suggestions,
    routes,
  };
}

export async function writeProjectRoleRoutingPlan(
  repoRootInput: string,
): Promise<ProjectRoleRoutingPlan> {
  const plan = await deriveProjectRoleRoutingPlan(repoRootInput);
  await mkdir(path.dirname(plan.artifactPath), { recursive: true });
  const persisted = {
    ...plan,
    exists: true,
  };
  await writeFile(plan.artifactPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectRoleRoutingPlan(
  repoRootInput: string,
): Promise<ProjectRoleRoutingPlan> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectRoleRoutingArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const fallbackChain = resolveFallbackChain();

  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectRoleRoutingPlan;
    return {
      ...parsed,
      repoRoot,
      artifactPath,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      fallbackChain,
      fallbackConfigured: fallbackChain.length > 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectRoleRoutingPlan({
        repoRoot,
        artifactPath,
        blueprintExists: blueprint.exists,
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        fallbackChain,
      });
    }
    throw error;
  }
}
