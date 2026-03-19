import * as childProcess from "node:child_process";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawCodeBootstrapOpts } from "../commands/openclawcode.js";
import type {
  CreateRepositoryRequest,
  GitHubAuthenticatedViewer,
  GitHubRepositorySummary,
  RepoRef,
} from "../openclawcode/github/client.js";
import { GitHubRestClient } from "../openclawcode/github/client.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

export type OnboardingGitHubAuthState =
  | { available: true; source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token" }
  | { available: false };

export type ResolvedOnboardingGitHubToken = {
  token: string;
  source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token";
};

type OnboardingBootstrapSummary = {
  repo?: {
    owner?: string;
    repo?: string;
    repoRoot?: string;
    checkoutAction?: string;
  };
  blueprint?: {
    blueprintPath?: string;
  };
  config?: {
    blueprintFirstBootstrap?: boolean;
  };
  handoff?: {
    cliRunCommand?: string | null;
  };
  nextAction?: string;
};

type OpenClawCodeOnboardingChoice = "new" | "existing" | "skip";

export function resolveOnboardingGitHubToken(): ResolvedOnboardingGitHubToken | null {
  const ghToken = process.env.GH_TOKEN?.trim();
  if (ghToken) {
    return { token: ghToken, source: "GH_TOKEN" };
  }

  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (githubToken) {
    return { token: githubToken, source: "GITHUB_TOKEN" };
  }

  const result = childProcess.spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    const token = result.stdout.trim();
    if (token) {
      return { token, source: "gh-auth-token" };
    }
  }

  return null;
}

export function resolveOnboardingGitHubAuthState(): OnboardingGitHubAuthState {
  const resolved = resolveOnboardingGitHubToken();
  if (!resolved) {
    return { available: false };
  }
  return {
    available: true,
    source: resolved.source,
  };
}

function validateNewRepositoryName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Repository name is required.";
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return "Use only letters, numbers, dots, underscores, or hyphens.";
  }
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    return "Repository name cannot start or end with a dot.";
  }
  return undefined;
}

function parseExistingRepositoryInput(value: string, owner: string): RepoRef {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Repository is required.");
  }
  if (trimmed.includes("/")) {
    const [parsedOwner, parsedRepo, ...rest] = trimmed.split("/");
    if (rest.length > 0 || !parsedOwner?.trim() || !parsedRepo?.trim()) {
      throw new Error("Use owner/repo when entering a full repository reference.");
    }
    return {
      owner: parsedOwner.trim(),
      repo: parsedRepo.trim(),
    };
  }
  return {
    owner,
    repo: trimmed,
  };
}

async function fetchRepositorySummary(
  token: string,
  repoRef: RepoRef,
): Promise<GitHubRepositorySummary | undefined> {
  const response = await fetch(`https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub repo lookup failed: ${response.status} ${response.statusText} ${body}`);
  }
  const payload = (await response.json()) as {
    name?: string | null;
    private?: boolean | null;
    html_url?: string | null;
    description?: string | null;
    default_branch?: string | null;
    updated_at?: string | null;
    owner?: { login?: string | null } | null;
  };
  const owner = payload.owner?.login?.trim();
  const repo = payload.name?.trim();
  if (!owner || !repo) {
    throw new Error("GitHub repo lookup succeeded but owner/name were missing.");
  }
  return {
    owner,
    repo,
    description: payload.description ?? undefined,
    private: payload.private !== false,
    defaultBranch:
      typeof payload.default_branch === "string" ? payload.default_branch : undefined,
    url: payload.html_url?.trim() || `https://github.com/${owner}/${repo}`,
    updatedAt: typeof payload.updated_at === "string" ? payload.updated_at : undefined,
  };
}

export const onboardingOpenClawCodeDeps = {
  resolveGitHubToken: resolveOnboardingGitHubToken,
  fetchAuthenticatedViewer: async (token: string): Promise<GitHubAuthenticatedViewer> =>
    new GitHubRestClient(token).fetchAuthenticatedViewer(),
  fetchRepositorySummary,
  createRepository: async (
    token: string,
    request: CreateRepositoryRequest,
  ): Promise<GitHubRepositorySummary> => new GitHubRestClient(token).createRepository(request),
  bootstrapRepository: async (
    opts: OpenClawCodeBootstrapOpts,
    runtime: RuntimeEnv,
  ): Promise<void> => {
    const { openclawCodeBootstrapCommand } = await import("../commands/openclawcode.js");
    await openclawCodeBootstrapCommand(opts, runtime);
  },
};

async function runBootstrapWithCapturedJson(params: {
  repo: string;
  bootstrapOpts?: Partial<OpenClawCodeBootstrapOpts>;
}): Promise<OnboardingBootstrapSummary> {
  const logs: string[] = [];
  const captureRuntime: RuntimeEnv = {
    log: (...args) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
    },
    error: (...args) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
    },
    exit: (code) => {
      throw new Error(`Bootstrap exited with code ${code}.`);
    },
  };
  await onboardingOpenClawCodeDeps.bootstrapRepository(
    {
      repo: params.repo,
      mode: "auto",
      json: true,
      ...params.bootstrapOpts,
    },
    captureRuntime,
  );
  const raw = logs.join("\n").trim();
  if (!raw) {
    throw new Error("Bootstrap completed but returned no JSON summary.");
  }
  return JSON.parse(raw) as OnboardingBootstrapSummary;
}

async function handleNewRepositorySetup(params: {
  token: ResolvedOnboardingGitHubToken;
  viewer: GitHubAuthenticatedViewer;
  prompter: WizardPrompter;
}): Promise<void> {
  const { token, viewer, prompter } = params;
  await prompter.note(
    [
      `Authenticated GitHub owner: ${viewer.login}`,
      "New repositories created from onboarding default to private visibility.",
    ].join("\n"),
    "OpenClaw Code",
  );

  while (true) {
    const repoName = await prompter.text({
      message: "New GitHub repository name",
      placeholder: "my-project",
      validate: validateNewRepositoryName,
    });
    const repoRef: RepoRef = {
      owner: viewer.login,
      repo: repoName.trim(),
    };

    const progress = prompter.progress("OpenClaw Code");
    let doneMessage = "OpenClaw Code step finished.";
    try {
      progress.update(`Checking ${repoRef.owner}/${repoRef.repo}…`);
      const existing = await onboardingOpenClawCodeDeps.fetchRepositorySummary(token.token, repoRef);
      if (existing) {
        await prompter.note(
          `${repoRef.owner}/${repoRef.repo} already exists. Enter a different repository name.`,
          "OpenClaw Code",
        );
        continue;
      }

      progress.update(`Creating ${repoRef.owner}/${repoRef.repo}…`);
      const created = await onboardingOpenClawCodeDeps.createRepository(token.token, {
        owner: repoRef.owner,
        name: repoRef.repo,
        private: true,
      });

      progress.update(`Bootstrapping ${created.owner}/${created.repo}…`);
      const payload = await runBootstrapWithCapturedJson({
        repo: `${created.owner}/${created.repo}`,
      });

      await prompter.note(
        [
          `Created repo: ${created.owner}/${created.repo}`,
          payload.repo?.repoRoot ? `Local path: ${payload.repo.repoRoot}` : undefined,
          payload.repo?.checkoutAction ? `Checkout: ${payload.repo.checkoutAction}` : undefined,
          payload.blueprint?.blueprintPath
            ? `Blueprint: ${payload.blueprint.blueprintPath}`
            : undefined,
          payload.config?.blueprintFirstBootstrap
            ? "Bootstrap detected an empty repo and entered blueprint-first startup mode."
            : undefined,
          payload.handoff?.cliRunCommand ? `Next: ${payload.handoff.cliRunCommand}` : undefined,
          payload.nextAction ? `Status: ${payload.nextAction}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        "OpenClaw Code repo ready",
      );
      doneMessage = "OpenClaw Code repo is ready.";
      return;
    } finally {
      progress.stop(doneMessage);
    }
  }
}

async function handleExistingRepositorySetup(params: {
  token: ResolvedOnboardingGitHubToken;
  viewer: GitHubAuthenticatedViewer;
  prompter: WizardPrompter;
}): Promise<void> {
  const { token, viewer, prompter } = params;
  while (true) {
    const repoInput = await prompter.text({
      message: "Existing GitHub repo (owner/repo or repo)",
      placeholder: `${viewer.login}/my-repo`,
      validate: (value) => {
        try {
          parseExistingRepositoryInput(value, viewer.login);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
    const repoRef = parseExistingRepositoryInput(repoInput, viewer.login);

    const progress = prompter.progress("OpenClaw Code");
    let doneMessage = "OpenClaw Code step finished.";
    try {
      progress.update(`Checking ${repoRef.owner}/${repoRef.repo}…`);
      const existing = await onboardingOpenClawCodeDeps.fetchRepositorySummary(token.token, repoRef);
      if (!existing) {
        await prompter.note(
          `${repoRef.owner}/${repoRef.repo} was not found or is not accessible with the current GitHub login.`,
          "OpenClaw Code",
        );
        continue;
      }

      progress.update(`Bootstrapping ${repoRef.owner}/${repoRef.repo}…`);
      const payload = await runBootstrapWithCapturedJson({
        repo: `${repoRef.owner}/${repoRef.repo}`,
      });

      await prompter.note(
        [
          `Repo: ${repoRef.owner}/${repoRef.repo}`,
          payload.repo?.repoRoot ? `Local path: ${payload.repo.repoRoot}` : undefined,
          payload.repo?.checkoutAction ? `Checkout: ${payload.repo.checkoutAction}` : undefined,
          payload.blueprint?.blueprintPath
            ? `Blueprint: ${payload.blueprint.blueprintPath}`
            : undefined,
          payload.handoff?.cliRunCommand ? `Next: ${payload.handoff.cliRunCommand}` : undefined,
          payload.nextAction ? `Status: ${payload.nextAction}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        "OpenClaw Code repo ready",
      );
      doneMessage = "OpenClaw Code repo is ready.";
      return;
    } finally {
      progress.stop(doneMessage);
    }
  }
}

export async function runOnboardingOpenClawCode(params: {
  prompter: WizardPrompter;
}): Promise<void> {
  const { prompter } = params;
  const resolvedToken = onboardingOpenClawCodeDeps.resolveGitHubToken();
  if (!resolvedToken) {
    await prompter.note(
      [
        "This build includes OpenClaw Code, but GitHub auth is not configured yet.",
        `Login once with: ${formatCliCommand("gh auth login")}`,
        "Then rerun onboarding or use OpenClaw Code later with:",
        `  ${formatCliCommand('openclaw code bootstrap --repo owner/repo --json')}`,
        "Docs: https://docs.openclaw.ai/cli/code",
      ].join("\n"),
      "OpenClaw Code",
    );
    return;
  }

  const viewer = await onboardingOpenClawCodeDeps.fetchAuthenticatedViewer(resolvedToken.token);
  const choice = await prompter.select<OpenClawCodeOnboardingChoice>({
    message: "OpenClaw Code repo setup",
    options: [
      { value: "new", label: "New repo" },
      { value: "existing", label: "Existing repo" },
      { value: "skip", label: "Skip for now" },
    ],
    initialValue: "skip",
  });

  if (choice === "skip") {
    await prompter.note(
      [
        `GitHub auth: ready via ${resolvedToken.source}.`,
        `Later: ${formatCliCommand("openclaw code bootstrap --repo owner/repo --json")}`,
        "Docs: https://docs.openclaw.ai/cli/code",
      ].join("\n"),
      "OpenClaw Code",
    );
    return;
  }

  if (choice === "new") {
    await handleNewRepositorySetup({
      token: resolvedToken,
      viewer,
      prompter,
    });
    return;
  }

  await handleExistingRepositorySetup({
    token: resolvedToken,
    viewer,
    prompter,
  });
}
