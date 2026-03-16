import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";

export const PROJECT_BLUEPRINT_FILENAME = "PROJECT-BLUEPRINT.md";
export const PROJECT_BLUEPRINT_SCHEMA_VERSION = 1;
export const PROJECT_BLUEPRINT_STATUSES = [
  "draft",
  "clarified",
  "agreed",
  "active",
  "superseded",
] as const;
export const PROJECT_BLUEPRINT_REQUIRED_SECTIONS = [
  "Goal",
  "Success Criteria",
  "Scope",
  "Non-Goals",
  "Constraints",
  "Risks",
  "Assumptions",
  "Human Gates",
  "Provider Strategy",
  "Workstreams",
  "Open Questions",
] as const;

export type ProjectBlueprintStatus = (typeof PROJECT_BLUEPRINT_STATUSES)[number];

export interface ProjectBlueprintSummary {
  repoRoot: string;
  blueprintPath: string;
  exists: boolean;
  schemaVersion: number | null;
  status: ProjectBlueprintStatus | null;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  agreedAt: string | null;
  goalSummary: string | null;
  sectionCount: number;
  sections: string[];
  requiredSectionsPresent: boolean;
  missingRequiredSections: string[];
  hasAgreementCheckpoint: boolean;
}

interface ProjectBlueprintFrontmatter {
  schemaVersion: number;
  title: string;
  status: ProjectBlueprintStatus;
  createdAt: string;
  updatedAt: string;
  agreedAt?: string;
}

export interface CreateProjectBlueprintOptions {
  repoRoot: string;
  title?: string;
  goal?: string;
  force?: boolean;
  now?: string;
}

export interface UpdateProjectBlueprintStatusOptions {
  repoRoot: string;
  status: ProjectBlueprintStatus;
  now?: string;
}

function isProjectBlueprintStatus(value: string): value is ProjectBlueprintStatus {
  return PROJECT_BLUEPRINT_STATUSES.includes(value as ProjectBlueprintStatus);
}

function normalizeProjectBlueprintStatus(value: string | undefined): ProjectBlueprintStatus | null {
  if (!value || !isProjectBlueprintStatus(value)) {
    return null;
  }
  return value;
}

function extractMarkdownTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function extractSectionNames(content: string): string[] {
  return [...content.matchAll(/^##\s+(.+)$/gm)]
    .map((match) => match[1]?.trim())
    .filter((section): section is string => Boolean(section));
}

function extractGoalSummary(content: string): string | null {
  const match = content.match(/^##\s+Goal\s*\n+([\s\S]*?)(?:\n##\s+|\s*$)/m);
  if (!match?.[1]) {
    return null;
  }
  const firstLine = match[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? null;
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: null, body: normalized };
  }
  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { frontmatter: null, body: normalized };
  }
  return {
    frontmatter: normalized.slice(4, endIndex),
    body: normalized.slice(endIndex + 5),
  };
}

function renderFrontmatter(frontmatter: ProjectBlueprintFrontmatter): string {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n`;
}

function renderProjectBlueprintBody(params: {
  title: string;
  goal: string;
  createdAt: string;
}): string {
  return [
    `# ${params.title}`,
    "",
    "## Goal",
    params.goal,
    "",
    "## Success Criteria",
    "- [ ] Define the first externally visible success criterion for this project.",
    "- [ ] Define the first proof that another operator can repeat.",
    "",
    "## Scope",
    "- In scope:",
    "- Out of scope:",
    "",
    "## Non-Goals",
    "- Record what this project should not attempt in the current delivery window.",
    "",
    "## Constraints",
    "- Technical:",
    "- Product:",
    "- Operational:",
    "",
    "## Risks",
    "- Record the main delivery, safety, or provider risks.",
    "",
    "## Assumptions",
    "- Record any assumption that still needs confirmation.",
    "",
    "## Human Gates",
    "- Goal agreement: required",
    "- Work item creation: operator may intervene",
    "- Merge or promotion: operator may intervene",
    "",
    "## Provider Strategy",
    "- Planner:",
    "- Coder:",
    "- Reviewer:",
    "- Verifier:",
    "- Doc-writer:",
    "",
    "## Workstreams",
    "- [ ] Break the blueprint into execution work items after agreement.",
    "",
    "## Open Questions",
    "- Record anything that still needs clarification.",
    "",
    "## Change Log",
    `- ${params.createdAt.slice(0, 10)}: blueprint scaffold created by \`openclaw code blueprint-init\`.`,
    "",
  ].join("\n");
}

function parseProjectBlueprintContent(params: {
  repoRoot: string;
  blueprintPath: string;
  content: string;
}): ProjectBlueprintSummary {
  const frontmatter = parseFrontmatterBlock(params.content);
  const status = normalizeProjectBlueprintStatus(frontmatter.status);
  const sections = extractSectionNames(params.content);
  const missingRequiredSections = PROJECT_BLUEPRINT_REQUIRED_SECTIONS.filter(
    (section) => !sections.includes(section),
  );
  const schemaVersionRaw = frontmatter.schemaVersion
    ? Number.parseInt(frontmatter.schemaVersion, 10)
    : Number.NaN;

  return {
    repoRoot: params.repoRoot,
    blueprintPath: params.blueprintPath,
    exists: true,
    schemaVersion: Number.isFinite(schemaVersionRaw) ? schemaVersionRaw : null,
    status,
    title: extractMarkdownTitle(params.content) ?? frontmatter.title ?? null,
    createdAt: frontmatter.createdAt ?? null,
    updatedAt: frontmatter.updatedAt ?? null,
    agreedAt: frontmatter.agreedAt ?? null,
    goalSummary: extractGoalSummary(params.content),
    sectionCount: sections.length,
    sections,
    requiredSectionsPresent: missingRequiredSections.length === 0,
    missingRequiredSections,
    hasAgreementCheckpoint:
      status === "agreed" ||
      status === "active" ||
      status === "superseded" ||
      Boolean(frontmatter.agreedAt),
  };
}

export function resolveProjectBlueprintPath(repoRoot: string): string {
  return path.join(repoRoot, PROJECT_BLUEPRINT_FILENAME);
}

export function projectBlueprintStatusIds(): ProjectBlueprintStatus[] {
  return [...PROJECT_BLUEPRINT_STATUSES];
}

export function parseProjectBlueprintStatus(value: string): ProjectBlueprintStatus {
  if (!isProjectBlueprintStatus(value)) {
    throw new Error(`--status must be one of: ${PROJECT_BLUEPRINT_STATUSES.join(", ")}`);
  }
  return value;
}

export async function readProjectBlueprint(repoRoot: string): Promise<ProjectBlueprintSummary> {
  const blueprintPath = resolveProjectBlueprintPath(repoRoot);
  try {
    const content = await readFile(blueprintPath, "utf8");
    return parseProjectBlueprintContent({ repoRoot, blueprintPath, content });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        repoRoot,
        blueprintPath,
        exists: false,
        schemaVersion: null,
        status: null,
        title: null,
        createdAt: null,
        updatedAt: null,
        agreedAt: null,
        goalSummary: null,
        sectionCount: 0,
        sections: [],
        requiredSectionsPresent: false,
        missingRequiredSections: [...PROJECT_BLUEPRINT_REQUIRED_SECTIONS],
        hasAgreementCheckpoint: false,
      };
    }
    throw error;
  }
}

export async function createProjectBlueprint(
  options: CreateProjectBlueprintOptions,
): Promise<ProjectBlueprintSummary> {
  const repoRoot = path.resolve(options.repoRoot);
  const blueprintPath = resolveProjectBlueprintPath(repoRoot);
  const existing = await readProjectBlueprint(repoRoot);
  if (existing.exists && !options.force) {
    throw new Error(
      `Project blueprint already exists at ${blueprintPath}. Use --force to overwrite it.`,
    );
  }

  const now = options.now ?? new Date().toISOString();
  const title = options.title?.trim() || `${path.basename(repoRoot)} project blueprint`;
  const goal =
    options.goal?.trim() || "Describe the agreed project goal here before autonomous work begins.";
  const frontmatter: ProjectBlueprintFrontmatter = {
    schemaVersion: PROJECT_BLUEPRINT_SCHEMA_VERSION,
    title,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  const content = `${renderFrontmatter(frontmatter)}\n${renderProjectBlueprintBody({
    title,
    goal,
    createdAt: now,
  })}`;
  await writeFile(blueprintPath, content, "utf8");
  return await readProjectBlueprint(repoRoot);
}

export async function updateProjectBlueprintStatus(
  options: UpdateProjectBlueprintStatusOptions,
): Promise<ProjectBlueprintSummary> {
  const repoRoot = path.resolve(options.repoRoot);
  const blueprintPath = resolveProjectBlueprintPath(repoRoot);
  const currentContent = await readFile(blueprintPath, "utf8");
  const current = parseProjectBlueprintContent({
    repoRoot,
    blueprintPath,
    content: currentContent,
  });
  const now = options.now ?? new Date().toISOString();
  const { body } = splitFrontmatter(currentContent);
  const frontmatter: ProjectBlueprintFrontmatter = {
    schemaVersion: current.schemaVersion ?? PROJECT_BLUEPRINT_SCHEMA_VERSION,
    title: current.title ?? `${path.basename(repoRoot)} project blueprint`,
    status: options.status,
    createdAt: current.createdAt ?? now,
    updatedAt: now,
  };
  if (current.agreedAt) {
    frontmatter.agreedAt = current.agreedAt;
  }
  if (options.status === "agreed" && !frontmatter.agreedAt) {
    frontmatter.agreedAt = now;
  }

  await writeFile(blueprintPath, `${renderFrontmatter(frontmatter)}\n${body.trimStart()}`, "utf8");
  return await readProjectBlueprint(repoRoot);
}
