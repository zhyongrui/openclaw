import type { Command } from "commander";
import { openclawCodeRunCommand } from "../../commands/openclawcode.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";
import { collectOption } from "./helpers.js";

export function registerCodeCommands(program: Command) {
  const code = program
    .command("code")
    .description("Run issue-driven coding workflows")
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${formatHelpExamples([
  ["openclaw code run --issue 123", "Plan and run the workflow for issue #123 in the current repo."],
  [
    'openclaw code run --issue 123 --test "pnpm exec vitest run --config vitest.openclawcode.config.mjs"',
    "Run a targeted test command after the builder edits code."
  ],
  [
    "openclaw code run --issue 123 --open-pr",
    "Push the issue branch and open a draft PR after build."
  ]
])}

${theme.muted("Docs:")} ${formatDocsLink("/cli/code", "docs.openclaw.ai/cli/code")}`,
    )
    .action(() => {
      code.help({ error: true });
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
            json: Boolean(opts.json)
          },
          defaultRuntime
        );
      });
    });
}
