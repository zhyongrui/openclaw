import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWizardPrompter as buildWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import {
  onboardingOpenClawCodeDeps,
  runOnboardingOpenClawCode,
  type ResolvedOnboardingGitHubToken,
} from "./setup.code.js";

describe("runOnboardingOpenClawCode", () => {
  beforeEach(() => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(() => null);
    onboardingOpenClawCodeDeps.fetchAuthenticatedViewer = vi.fn(
      async () => ({ login: "zhyongrui" }),
    );
    onboardingOpenClawCodeDeps.fetchRepositorySummary = vi.fn(async () => undefined);
    onboardingOpenClawCodeDeps.createRepository = vi.fn(
      async (_token, request) =>
        ({
          owner: request.owner ?? "zhyongrui",
          repo: request.name,
          private: request.private !== false,
          url: `https://github.com/${request.owner ?? "zhyongrui"}/${request.name}`,
        }) as never,
    );
    onboardingOpenClawCodeDeps.bootstrapRepository = vi.fn(async (_opts, runtime) => {
      runtime.log(
        JSON.stringify({
          repo: {
            owner: "zhyongrui",
            repo: "iGallery",
            repoRoot: "/home/zyr/pros/iGallery",
            checkoutAction: "cloned",
          },
          blueprint: {
            blueprintPath: "/home/zyr/pros/iGallery/PROJECT-BLUEPRINT.md",
          },
          config: {
            blueprintFirstBootstrap: true,
          },
          handoff: {
            cliRunCommand:
              "openclaw code run --issue <issue-number> --owner zhyongrui --repo iGallery",
          },
          nextAction: "start-or-restart-live-gateway",
        }),
      );
    });
  });

  it("shows gh auth guidance when GitHub auth is missing", async () => {
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    expect(noteCalls.some((call) => call[1] === "OpenClaw Code")).toBe(true);
    expect(noteCalls.at(-1)?.[0]).toContain("gh auth login");
  });

  it("creates and bootstraps a new repo with a placeholder empty-repo test command", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "GH_TOKEN",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    const note = vi.fn(async () => {});
    const progressStop = vi.fn();
    const progressUpdate = vi.fn();
    const prompter = buildWizardPrompter({
      note,
      select: vi.fn(async (params: { message: string }) => {
        if (params.message === "OpenClaw Code repo setup") {
          return "new";
        }
        return "later";
      }) as never,
      text: vi.fn(async (params: { message: string }) => {
        if (params.message === "New GitHub repository name") {
          return "iGallery";
        }
        return "";
      }),
      progress: vi.fn(() => ({ update: progressUpdate, stop: progressStop })),
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    expect(onboardingOpenClawCodeDeps.createRepository).toHaveBeenCalledWith("gho_test", {
      owner: "zhyongrui",
      name: "iGallery",
      private: true,
    });
    expect(onboardingOpenClawCodeDeps.bootstrapRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "zhyongrui/iGallery",
        mode: "auto",
        json: true,
      }),
      expect.any(Object),
    );
    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    const readyNote = noteCalls.find((call) => call[1] === "OpenClaw Code repo ready");
    expect(readyNote?.[0]).toContain("Created repo: zhyongrui/iGallery");
    expect(readyNote?.[0]).toContain("PROJECT-BLUEPRINT.md");
    expect(readyNote?.[0]).toContain("blueprint-first startup mode");
    expect(progressUpdate).toHaveBeenCalled();
    expect(progressStop).toHaveBeenCalled();
  });

  it("bootstraps an existing repo from a bare repo name under the authenticated owner", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "gh-auth-token",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    onboardingOpenClawCodeDeps.fetchRepositorySummary = vi.fn(async (_token, repoRef) => ({
      owner: repoRef.owner,
      repo: repoRef.repo,
      private: true,
      url: `https://github.com/${repoRef.owner}/${repoRef.repo}`,
    }));
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
      select: vi.fn(async (params: { message: string }) => {
        if (params.message === "OpenClaw Code repo setup") {
          return "existing";
        }
        return "later";
      }) as never,
      text: vi.fn(async () => "iGallery"),
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    expect(onboardingOpenClawCodeDeps.fetchRepositorySummary).toHaveBeenCalledWith("gho_test", {
      owner: "zhyongrui",
      repo: "iGallery",
    });
    expect(onboardingOpenClawCodeDeps.bootstrapRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "zhyongrui/iGallery",
        mode: "auto",
        json: true,
      }),
      expect.any(Object),
    );
  });
});
