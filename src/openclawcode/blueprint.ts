import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";

export const PROJECT_BLUEPRINT_FILENAME = "PROJECT-BLUEPRINT.md";
export const PROJECT_BLUEPRINT_SCHEMA_VERSION = 1;
export const PROJECT_BLUEPRINT_ROLE_IDS = [
  "planner",
  "coder",
  "reviewer",
  "verifier",
  "docWriter",
] as const;
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
export type ProjectBlueprintRoleId = (typeof PROJECT_BLUEPRINT_ROLE_IDS)[number];

export interface ProjectBlueprintRoleAssignments {
  planner: string | null;
  coder: string | null;
  reviewer: string | null;
  verifier: string | null;
  docWriter: string | null;
}

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
  statusChangedAt: string | null;
  revisionId: string | null;
  contentSha256: string | null;
  goalSummary: string | null;
  sectionCount: number;
  sections: string[];
  frontmatterKeys: string[];
  requiredSectionsPresent: boolean;
  missingRequiredSections: string[];
  hasAgreementCheckpoint: boolean;
  defaultedSectionCount: number;
  defaultedSections: string[];
  workstreamCandidateCount: number;
  openQuestionCount: number;
  humanGateCount: number;
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
}

export interface ProjectBlueprintClarificationReport extends ProjectBlueprintSummary {
  questions: string[];
  suggestions: string[];
  questionCount: number;
  suggestionCount: number;
}

export interface ProjectBlueprintDocument extends ProjectBlueprintSummary {
  content: string | null;
  sectionBodies: Partial<Record<string, string>>;
}

interface ProjectBlueprintFrontmatter {
  schemaVersion: number;
  title: string;
  status: ProjectBlueprintStatus;
  createdAt: string;
  updatedAt: string;
  statusChangedAt?: string;
  agreedAt?: string;
}

const PROJECT_BLUEPRINT_PLACEHOLDER_SNIPPETS: Partial<
  Record<(typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number], string[]>
> = {
  Goal: ["Describe the agreed project goal here before autonomous work begins."],
  "Success Criteria": [
    "Define the first externally visible success criterion for this project.",
    "Define the first proof that another operator can repeat.",
  ],
  Scope: ["In scope:", "Out of scope:"],
  "Non-Goals": ["Record what this project should not attempt in the current delivery window."],
  Constraints: ["Technical:", "Product:", "Operational:"],
  Risks: ["Record the main delivery, safety, or provider risks."],
  Assumptions: ["Record any assumption that still needs confirmation."],
  "Human Gates": [
    "Goal agreement: required",
    "Work item creation: operator may intervene",
    "Merge or promotion: operator may intervene",
  ],
  "Provider Strategy": ["Planner:", "Coder:", "Reviewer:", "Verifier:", "Doc-writer:"],
  Workstreams: ["Break the blueprint into execution work items after agreement."],
  "Open Questions": ["Record anything that still needs clarification."],
};

const PROJECT_BLUEPRINT_PROVIDER_ROLE_HEADINGS: Record<string, ProjectBlueprintRoleId> = {
  Planner: "planner",
  Coder: "coder",
  Reviewer: "reviewer",
  Verifier: "verifier",
  "Doc-writer": "docWriter",
};

const PROJECT_BLUEPRINT_PROVIDER_ROLE_LABELS: Record<ProjectBlueprintRoleId, string> = {
  planner: "Planner",
  coder: "Coder",
  reviewer: "Reviewer",
  verifier: "Verifier",
  docWriter: "Doc-writer",
};

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

function normalizeMarkdownListItem(line: string): string | null {
  const trimmed = line.trim();
  const match =
    trimmed.match(/^[-*]\s+\[(?: |x|X)\]\s+(.+)$/) ??
    trimmed.match(/^[-*]\s+(.+)$/) ??
    trimmed.match(/^\d+\.\s+(.+)$/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractMarkdownListItems(content: string): string[] {
  return content
    .split("\n")
    .map((line) => normalizeMarkdownListItem(line))
    .filter((item): item is string => Boolean(item))
    .filter((item) => !/^none\b/i.test(item));
}

function extractGoalSummary(content: string): string | null {
  const sections = extractSectionBodies(content);
  const goalBody = sections.Goal;
  if (!goalBody) {
    return null;
  }
  const firstLine = goalBody
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? null;
}

function extractSectionBodies(content: string): Partial<Record<string, string>> {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const headings = [...normalized.matchAll(/^##\s+(.+)$/gm)];
  const sections: Partial<Record<string, string>> = {};

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const sectionName = heading[1]?.trim();
    const sectionStart = heading.index == null ? -1 : heading.index + heading[0].length;
    const nextHeadingIndex = headings[index + 1]?.index ?? normalized.length;
    if (!sectionName || sectionStart < 0) {
      continue;
    }
    sections[sectionName] = normalized.slice(sectionStart, nextHeadingIndex).trim();
  }

  return sections;
}

function joinNaturalLanguageList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
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

function emptyProjectBlueprintRoleAssignments(): ProjectBlueprintRoleAssignments {
  return {
    planner: null,
    coder: null,
    reviewer: null,
    verifier: null,
    docWriter: null,
  };
}

function parseProjectBlueprintRoleAssignments(
  providerStrategyBody: string | undefined,
): ProjectBlueprintRoleAssignments {
  const assignments = emptyProjectBlueprintRoleAssignments();
  if (!providerStrategyBody) {
    return assignments;
  }

  for (const item of extractMarkdownListItems(providerStrategyBody)) {
    const match = item.match(/^([^:]+):\s*(.*)$/);
    if (!match?.[1]) {
      continue;
    }
    const roleId = PROJECT_BLUEPRINT_PROVIDER_ROLE_HEADINGS[match[1].trim()];
    if (!roleId) {
      continue;
    }
    const value = match[2]?.trim() || null;
    assignments[roleId] = value && value.length > 0 ? value : null;
  }

  return assignments;
}

function defaultedProjectBlueprintSections(
  sectionBodies: Partial<Record<string, string>>,
): (typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number][] {
  return PROJECT_BLUEPRINT_REQUIRED_SECTIONS.filter((section) => {
    const body = sectionBodies[section];
    if (!body) {
      return false;
    }
    const placeholders = PROJECT_BLUEPRINT_PLACEHOLDER_SNIPPETS[section] ?? [];
    if (placeholders.length === 0) {
      return false;
    }

    const placeholderListItems = placeholders
      .map((placeholder) => normalizeMarkdownListItem(placeholder) ?? placeholder.trim())
      .filter((item): item is string => Boolean(item));
    const actualListItems = extractMarkdownListItems(body);
    if (actualListItems.length > 0 && placeholderListItems.length === placeholders.length) {
      return (
        actualListItems.length === placeholderListItems.length &&
        actualListItems.every((item, index) => item === placeholderListItems[index])
      );
    }

    return body.trim() === placeholders.join("\n").trim();
  });
}

function computeBlueprintContentSha(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(normalized).digest("hex");
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
  const sectionBodies = extractSectionBodies(params.content);
  const status = normalizeProjectBlueprintStatus(frontmatter.status);
  const sections = extractSectionNames(params.content);
  const missingRequiredSections = PROJECT_BLUEPRINT_REQUIRED_SECTIONS.filter(
    (section) => !sections.includes(section),
  );
  const defaultedSections = defaultedProjectBlueprintSections(sectionBodies);
  const schemaVersionRaw = frontmatter.schemaVersion
    ? Number.parseInt(frontmatter.schemaVersion, 10)
    : Number.NaN;
  const contentSha256 = computeBlueprintContentSha(params.content);
  const workstreamItems = defaultedSections.includes("Workstreams")
    ? []
    : extractMarkdownListItems(sectionBodies.Workstreams ?? "");
  const openQuestions = defaultedSections.includes("Open Questions")
    ? []
    : extractMarkdownListItems(sectionBodies["Open Questions"] ?? "");
  const humanGates = defaultedSections.includes("Human Gates")
    ? []
    : extractMarkdownListItems(sectionBodies["Human Gates"] ?? "");

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
    statusChangedAt: frontmatter.statusChangedAt ?? frontmatter.updatedAt ?? null,
    revisionId: contentSha256.slice(0, 12),
    contentSha256,
    goalSummary: extractGoalSummary(params.content),
    sectionCount: sections.length,
    sections,
    frontmatterKeys: Object.keys(frontmatter).toSorted(),
    requiredSectionsPresent: missingRequiredSections.length === 0,
    missingRequiredSections,
    hasAgreementCheckpoint:
      status === "agreed" ||
      status === "active" ||
      status === "superseded" ||
      Boolean(frontmatter.agreedAt),
    defaultedSectionCount: defaultedSections.length,
    defaultedSections,
    workstreamCandidateCount: workstreamItems.length,
    openQuestionCount: openQuestions.length,
    humanGateCount: humanGates.length,
    providerRoleAssignments: parseProjectBlueprintRoleAssignments(
      sectionBodies["Provider Strategy"],
    ),
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
        statusChangedAt: null,
        revisionId: null,
        contentSha256: null,
        goalSummary: null,
        sectionCount: 0,
        sections: [],
        frontmatterKeys: [],
        requiredSectionsPresent: false,
        missingRequiredSections: [...PROJECT_BLUEPRINT_REQUIRED_SECTIONS],
        hasAgreementCheckpoint: false,
        defaultedSectionCount: 0,
        defaultedSections: [],
        workstreamCandidateCount: 0,
        openQuestionCount: 0,
        humanGateCount: 0,
        providerRoleAssignments: emptyProjectBlueprintRoleAssignments(),
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
    statusChangedAt: now,
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
    statusChangedAt: current.status === options.status ? (current.statusChangedAt ?? now) : now,
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

export async function readProjectBlueprintDocument(
  repoRootInput: string,
): Promise<ProjectBlueprintDocument> {
  const repoRoot = path.resolve(repoRootInput);
  const summary = await readProjectBlueprint(repoRoot);
  if (!summary.exists) {
    return {
      ...summary,
      content: null,
      sectionBodies: {},
    };
  }

  const content = await readFile(summary.blueprintPath, "utf8");
  return {
    ...parseProjectBlueprintContent({
      repoRoot,
      blueprintPath: summary.blueprintPath,
      content,
    }),
    content,
    sectionBodies: extractSectionBodies(content),
  };
}

export async function inspectProjectBlueprintClarifications(
  repoRootInput: string,
): Promise<ProjectBlueprintClarificationReport> {
  const summary = await readProjectBlueprintDocument(repoRootInput);
  const questions = new Set<string>();
  const suggestions = new Set<string>();

  if (!summary.exists) {
    questions.add(
      "No project blueprint exists yet. Run `openclaw code blueprint-init` before trying to decompose work.",
    );
    return {
      ...summary,
      questions: [...questions],
      suggestions: [...suggestions],
      questionCount: questions.size,
      suggestionCount: suggestions.size,
    };
  }

  for (const section of summary.missingRequiredSections) {
    questions.add(
      `Fill the \`${section}\` section in PROJECT-BLUEPRINT.md before deriving work items.`,
    );
  }

  for (const section of PROJECT_BLUEPRINT_REQUIRED_SECTIONS) {
    const body = summary.sectionBodies[section];
    if (!body) {
      continue;
    }
    if (!summary.defaultedSections.includes(section)) {
      continue;
    }
    switch (section) {
      case "Goal":
        questions.add("Replace the default Goal placeholder with the actual project objective.");
        break;
      case "Success Criteria":
        questions.add("Replace the default Success Criteria bullets with concrete proof targets.");
        break;
      case "Scope":
        questions.add("List what is explicitly in scope and out of scope for this blueprint.");
        break;
      case "Workstreams":
        questions.add(
          "Break the blueprint into initial workstreams before autonomous issue creation.",
        );
        break;
      case "Provider Strategy":
        suggestions.add(
          "Choose preferred providers or defaults for planner, coder, reviewer, verifier, and doc-writer roles.",
        );
        break;
      case "Human Gates":
        suggestions.add(
          "Decide which stages must pause for human approval versus continuing autonomously.",
        );
        break;
      default:
        suggestions.add(`Replace the default placeholder text in the \`${section}\` section.`);
        break;
    }
  }

  if (summary.status === "draft") {
    suggestions.add(
      "Once the blueprint is clarified, record that checkpoint with `openclaw code blueprint-set-status --status clarified`.",
    );
  }
  if (!summary.hasAgreementCheckpoint) {
    suggestions.add(
      "When the team agrees on the target, record it with `openclaw code blueprint-set-status --status agreed`.",
    );
  }

  if (summary.openQuestionCount > 0) {
    questions.add(
      "Confirm the remaining `Open Questions` entries or replace them with `- None.` when settled.",
    );
  }

  const unresolvedProviderRoles = (
    Object.entries(summary.providerRoleAssignments) as Array<
      [ProjectBlueprintRoleId, string | null]
    >
  )
    .filter(([, assignment]) => !assignment || assignment.trim().length === 0)
    .map(([roleId]) => PROJECT_BLUEPRINT_PROVIDER_ROLE_LABELS[roleId]);
  if (unresolvedProviderRoles.length > 0) {
    suggestions.add(
      `Record explicit assignments for ${joinNaturalLanguageList(unresolvedProviderRoles)} under \`Provider Strategy\` when you want a fixed multi-agent plan.`,
    );
  }

  return {
    ...summary,
    questions: [...questions],
    suggestions: [...suggestions],
    questionCount: questions.size,
    suggestionCount: suggestions.size,
  };
}
