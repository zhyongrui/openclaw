import type { Command } from "commander";
import {
  openclawCodeBlueprintClarifyCommand,
  openclawCodeBlueprintDecomposeCommand,
  openclawCodeBlueprintInitCommand,
  openclawCodeBlueprintSetStatusCommand,
  openclawCodeBlueprintShowCommand,
  openclawCodeBlueprintStatusIds,
  openclawCodeDiscoverWorkItemsCommand,
  openclawCodeListValidationIssuesCommand,
  openclawCodeRoleRoutingRefreshCommand,
  openclawCodeRoleRoutingShowCommand,
  openclawCodeReconcileValidationIssuesCommand,
  openclawCodeRunCommand,
  openclawCodeSeedValidationIssueCommand,
  openclawCodeSeedValidationIssueTemplateIds,
  openclawCodeWorkItemsShowCommand,
} from "../../commands/openclawcode.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";
import { collectOption } from "./helpers.js";

export function registerCodeCommands(program: Command) {
  const code = program
    .command("code")
    .description("Run issue-driven and blueprint-first coding workflows")
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${formatHelpExamples([
  [
    'openclaw code blueprint-init --title "OpenClawCode Blueprint" --goal "Ship blueprint-first autonomous development"',
    "Create the fixed repo-local project blueprint scaffold.",
  ],
  [
    "openclaw code blueprint-show --json",
    "Inspect the current project blueprint state in machine-readable form.",
  ],
  [
    "openclaw code blueprint-clarify --json",
    "Ask the repo-local blueprint what still needs clarification before work decomposition.",
  ],
  [
    "openclaw code blueprint-set-status --status agreed",
    "Record the explicit blueprint agreement checkpoint.",
  ],
  [
    "openclaw code blueprint-decompose --json",
    "Derive and persist repo-local work items from the fixed project blueprint.",
  ],
  [
    "openclaw code work-items-show --json",
    "Inspect the latest persisted work-item inventory and stale-state signals.",
  ],
  [
    "openclaw code discover-work-items --json",
    "Run the first non-validation discovery pipeline and persist discovered work items.",
  ],
  [
    "openclaw code role-routing-refresh --json",
    "Persist the current provider-neutral role routing plan.",
  ],
  ["openclaw code role-routing-show --json", "Inspect the latest persisted role-routing artifact."],
  [
    "openclaw code run --issue 123",
    "Plan and run the workflow for issue #123 in the current repo.",
  ],
  [
    'openclaw code run --issue 123 --test "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"',
    "Run a targeted test command after the builder edits code.",
  ],
  [
    "openclaw code run --issue 123 --open-pr",
    "Push the issue branch and open a draft PR after build.",
  ],
  [
    "openclaw code seed-validation-issue --template command-json-boolean --field-name verificationHasSignals --source-path verificationReport.followUps --dry-run",
    "Draft a low-risk validation issue without creating it on GitHub.",
  ],
  [
    "openclaw code list-validation-issues --json",
    "Inspect the current validation-pool inventory for the current repo.",
  ],
  [
    "openclaw code reconcile-validation-issues --close-implemented --json",
    "Close already-implemented validation issues and report the next pool action.",
  ],
])}

${theme.muted("Docs:")} ${formatDocsLink("/cli/code", "docs.openclaw.ai/cli/code")}`,
    )
    .action(() => {
      code.help({ error: true });
    });

  code
    .command("blueprint-init")
    .description("Create the fixed project blueprint scaffold in the current repo")
    .option("--repo-root <dir>", "Local repository root")
    .option("--title <text>", "Blueprint title")
    .option("--goal <text>", "Initial goal summary for the blueprint")
    .option("--force", "Overwrite an existing blueprint scaffold", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintInitCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            title: opts.title as string | undefined,
            goal: opts.goal as string | undefined,
            force: Boolean(opts.force),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-show")
    .description("Show the current fixed project blueprint state")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-clarify")
    .description("Report clarification questions and suggestions for the current blueprint")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintClarifyCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-set-status")
    .description("Update the fixed project blueprint lifecycle status")
    .requiredOption(
      "--status <status>",
      `Blueprint status (${openclawCodeBlueprintStatusIds().join(", ")})`,
    )
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintSetStatusCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            status: opts.status as string,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-decompose")
    .description("Derive and persist work items from the current fixed project blueprint")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintDecomposeCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("work-items-show")
    .description("Show the current repo-local work-item inventory artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeWorkItemsShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("discover-work-items")
    .description("Run repo-local discovery and persist discovered work items")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeDiscoverWorkItemsCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("role-routing-refresh")
    .description("Persist the current provider-neutral role routing plan")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRoleRoutingRefreshCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("role-routing-show")
    .description("Show the current provider-neutral role routing artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRoleRoutingShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("run")
    .description("Execute the openclawcode workflow for a GitHub issue")
    .requiredOption("--issue <number>", "GitHub issue number")
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--state-dir <dir>", "State directory for run records and worktrees")
    .option("--base-branch <branch>", "Base branch for the run", "main")
    .option("--branch-name <branch>", "Explicit issue branch name")
    .option("--builder-agent <id>", "Agent id for the builder pass")
    .option("--verifier-agent <id>", "Agent id for the verifier pass")
    .option("--test <command>", "Repeatable test command to run after build", collectOption, [])
    .option("--open-pr", "Push the issue branch and open a draft PR", false)
    .option("--merge-on-approve", "Merge automatically after verifier approval", false)
    .option("--rerun-prior-run-id <id>", "Prior run id when this execution is an explicit rerun")
    .option(
      "--rerun-prior-stage <stage>",
      "Prior workflow stage when this execution is an explicit rerun",
    )
    .option("--rerun-reason <text>", "Human or review reason for rerunning the issue")
    .option("--rerun-requested-at <iso>", "ISO timestamp for when the rerun was requested")
    .option(
      "--rerun-review-decision <decision>",
      "Latest GitHub review decision for the rerun context",
    )
    .option("--rerun-review-submitted-at <iso>", "ISO timestamp for the latest GitHub review")
    .option("--rerun-review-summary <text>", "Latest GitHub review summary or body")
    .option("--rerun-review-url <url>", "URL for the latest GitHub review")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRunCommand(
          {
            issue: opts.issue as string,
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            stateDir: opts.stateDir as string | undefined,
            baseBranch: opts.baseBranch as string | undefined,
            branchName: opts.branchName as string | undefined,
            builderAgent: opts.builderAgent as string | undefined,
            verifierAgent: opts.verifierAgent as string | undefined,
            test: Array.isArray(opts.test) ? (opts.test as string[]) : [],
            openPr: Boolean(opts.openPr),
            mergeOnApprove: Boolean(opts.mergeOnApprove),
            rerunPriorRunId: opts.rerunPriorRunId as string | undefined,
            rerunPriorStage: opts.rerunPriorStage as
              | "intake"
              | "planning"
              | "building"
              | "draft-pr-opened"
              | "verifying"
              | "changes-requested"
              | "ready-for-human-review"
              | "completed-without-changes"
              | "merged"
              | "escalated"
              | "failed"
              | undefined,
            rerunReason: opts.rerunReason as string | undefined,
            rerunRequestedAt: opts.rerunRequestedAt as string | undefined,
            rerunReviewDecision: opts.rerunReviewDecision as
              | "approved"
              | "changes-requested"
              | undefined,
            rerunReviewSubmittedAt: opts.rerunReviewSubmittedAt as string | undefined,
            rerunReviewSummary: opts.rerunReviewSummary as string | undefined,
            rerunReviewUrl: opts.rerunReviewUrl as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("seed-validation-issue")
    .description("Create or preview a repository-local validation issue for openclawcode")
    .requiredOption(
      "--template <id>",
      `Template id (${openclawCodeSeedValidationIssueTemplateIds().join(", ")})`,
    )
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--field-name <name>", "Top-level JSON field name for command-json templates")
    .option("--source-path <path>", "Nested source path for command-json templates")
    .option("--doc-path <path>", "Docs path for operator-doc-note")
    .option("--summary <text>", "Summary for doc-note or high-risk validation templates")
    .option("--dry-run", "Render the seeded issue without creating it on GitHub", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeSeedValidationIssueCommand(
          {
            template: opts.template as ReturnType<
              typeof openclawCodeSeedValidationIssueTemplateIds
            >[number],
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            fieldName: opts.fieldName as string | undefined,
            sourcePath: opts.sourcePath as string | undefined,
            docPath: opts.docPath as string | undefined,
            summary: opts.summary as string | undefined,
            dryRun: Boolean(opts.dryRun),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("list-validation-issues")
    .description("List the current repository-local validation issue pool")
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--state <state>", "Issue state to query (open, closed, all)", "open")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeListValidationIssuesCommand(
          {
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            state: opts.state as "open" | "closed" | "all" | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("reconcile-validation-issues")
    .description("Close already-implemented validation issues and summarize the next pool action")
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option(
      "--close-implemented",
      "Close command-layer validation issues already satisfied by the repo",
      false,
    )
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeReconcileValidationIssuesCommand(
          {
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            closeImplemented: Boolean(opts.closeImplemented),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });
}
