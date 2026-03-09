import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../contracts/index.js";
import type { AgentRunner, ShellRunner } from "../runtime/index.js";
import { AgentBackedBuilder, __testing } from "./agent-backed.js";

function createRun(): WorkflowRun {
  return {
    id: "run-1",
    stage: "planning",
    issue: {
      owner: "zhyongrui",
      repo: "openclawcode",
      number: 1,
      title: "Persist draft PR number in workflow output",
      body: "Record the draft PR number in structured workflow artifacts.",
      labels: ["enhancement"],
    },
    createdAt: "2026-03-09T14:00:00.000Z",
    updatedAt: "2026-03-09T14:00:00.000Z",
    attempts: {
      total: 1,
      planning: 1,
      building: 0,
      verifying: 0,
    },
    stageRecords: [],
    executionSpec: {
      summary: "Implement issue #1",
      scope: ["Persist draft PR number in workflow output."],
      outOfScope: ["Unrelated refactors"],
      acceptanceCriteria: [
        {
          id: "persist-number",
          text: "Workflow artifacts include the draft PR number.",
          required: true,
        },
      ],
      testPlan: ["Run targeted openclawcode tests."],
      risks: [],
      assumptions: [],
      openQuestions: [],
      riskLevel: "medium",
    },
    workspace: {
      repoRoot: "/repo",
      baseBranch: "main",
      branchName: "openclawcode/issue-1",
      worktreePath: "/repo/.openclawcode/worktrees/run-1",
      preparedAt: "2026-03-09T14:00:00.000Z",
    },
    history: [],
  };
}

describe("AgentBackedBuilder prompt", () => {
  it("guides the agent toward targeted openclawcode paths", () => {
    const prompt = __testing.buildBuilderPrompt(createRun(), [
      "npx --yes -p vitest@4.0.18 vitest run --config vitest.openclawcode.config.mjs",
    ]);

    expect(prompt).toContain(
      "Start with targeted reads in the hinted files below, plus nearby tests and docs/openclawcode/",
    );
    expect(prompt).toContain("Avoid broad scans such as `rg ... .`");
    expect(prompt).toContain("Issue Classification:");
    expect(prompt).toContain("- src/openclawcode/app/run-issue.ts");
    expect(prompt).toContain("- src/openclawcode/testing/run-issue.test.ts");
    expect(prompt).toContain("The workflow host will run these final validation commands");
    expect(prompt).toContain(
      "Do not run the full final validation command inside the agent sandbox",
    );
  });

  it("adds command-layer hints for CLI-facing issues", () => {
    const prompt = __testing.buildBuilderPrompt(
      {
        ...createRun(),
        issue: {
          ...createRun().issue,
          number: 2,
          title: "Include changed file list in openclaw code run --json output",
          body: "Ensure the CLI command exposes a stable --json field for changed files.",
        },
      },
      ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
    );

    expect(prompt).toContain(
      "This issue appears command-layer focused. Prefer the smallest fix in src/commands/openclawcode.ts and its tests first.",
    );
    expect(prompt).toContain("- command-layer");
    expect(prompt).toContain("- src/commands/openclawcode.ts");
    expect(prompt).toContain("- src/commands/openclawcode.test.ts");
    expect(prompt).toContain(
      "If the requested behavior can be derived from existing workflow state",
    );
  });
});

class FakeAgentRunner implements AgentRunner {
  async run() {
    return {
      text: "Implemented the change.",
      raw: {},
    };
  }
}

class FakeShellRunner implements ShellRunner {
  async run(request: { cwd: string; command: string }) {
    return {
      command: request.command,
      code: 0,
      stdout: "",
      stderr: "",
    };
  }
}

describe("AgentBackedBuilder scope enforcement", () => {
  it("fails command-layer builds that edit blocked workflow-core files", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const builder = new AgentBackedBuilder({
      agentRunner: new FakeAgentRunner(),
      shellRunner: new FakeShellRunner(),
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      autoCommit: false,
      collectChangedFiles: async () => [
        "src/commands/openclawcode.ts",
        "src/openclawcode/contracts/types.ts",
      ],
    });

    try {
      await expect(
        builder.build({
          ...createRun(),
          issue: {
            ...createRun().issue,
            number: 2,
            title: "Include changed file list in openclaw code run --json output",
            body: "Ensure the CLI command exposes a stable --json field for changed files.",
          },
          workspace: {
            ...createRun().workspace!,
            worktreePath,
          },
        }),
      ).rejects.toThrow(/workflow-core files/i);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
