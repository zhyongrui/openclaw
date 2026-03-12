import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../contracts/index.js";
import { assessIssueSuitability } from "./suitability.js";

function createRun(): WorkflowRun {
  return {
    id: "run-1",
    stage: "planning",
    issue: {
      owner: "zhyongrui",
      repo: "openclawcode",
      number: 1,
      title: "Expose changed file count in openclaw code run --json output",
      body: "Add one stable top-level CLI JSON field and update targeted command tests.",
      labels: ["enhancement"],
    },
    createdAt: "2026-03-12T07:00:00.000Z",
    updatedAt: "2026-03-12T07:00:00.000Z",
    attempts: {
      total: 1,
      planning: 1,
      building: 0,
      verifying: 0,
    },
    stageRecords: [],
    executionSpec: {
      summary: "Implement issue #1",
      scope: ["Add a small CLI JSON field."],
      outOfScope: ["Unrelated refactors"],
      acceptanceCriteria: [
        {
          id: "cli-json",
          text: "CLI JSON output includes the new field.",
          required: true,
        },
      ],
      testPlan: ["Run targeted command tests."],
      risks: [],
      assumptions: [],
      openQuestions: [],
      riskLevel: "medium",
    },
    history: [],
  };
}

describe("assessIssueSuitability", () => {
  it("accepts low-risk command-layer issues for autonomous execution", () => {
    const result = assessIssueSuitability(createRun(), "2026-03-12T07:01:00.000Z");

    expect(result).toEqual({
      decision: "auto-run",
      summary:
        "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
      reasons: [
        "Issue stays within command-layer scope.",
        "Planner risk level is medium.",
        "No high-risk issue signals were detected in the issue text or labels.",
      ],
      classification: "command-layer",
      riskLevel: "medium",
      evaluatedAt: "2026-03-12T07:01:00.000Z",
    });
  });

  it("requires human review for mixed-scope issues", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        title: "Expose orchestrator retry metadata in openclaw code run --json output",
        body: [
          "Update the CLI output and workflow persistence so retry metadata is visible.",
          "This also requires orchestrator resume behavior and stored run record updates.",
        ].join(" "),
      },
    };

    const result = assessIssueSuitability(run, "2026-03-12T07:01:00.000Z");

    expect(result.decision).toBe("needs-human-review");
    expect(result.classification).toBe("mixed");
    expect(result.reasons).toContain(
      "Issue is classified as mixed scope instead of command-layer.",
    );
  });

  it("accepts marked operator-doc validation issues for autonomous execution", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        number: 86,
        title: "[Docs]: Clarify provider-pause behavior for auto-queued work",
        body: [
          "<!-- openclawcode-validation template=operator-doc-note class=operator-docs -->",
          "",
          "Summary",
          "Clarify how auto-queued work behaves when a provider pause is active.",
          "",
          "Proposed solution",
          "Update `docs/openclawcode/operator-setup.md` with a short note that explains the observable behavior during an active provider pause, including that queue intake can succeed before execution resumes.",
          "- keep the change docs-only",
          "- keep the note specific to operator behavior during active provider pauses",
        ].join("\n"),
      },
      executionSpec: {
        ...createRun().executionSpec!,
        summary: "Clarify one operator doc note.",
        scope: ["Update docs/openclawcode/operator-setup.md only."],
        testPlan: ["No runtime code changes; keep docs-only validation narrow."],
      },
    };

    const result = assessIssueSuitability(run, "2026-03-12T17:25:00.000Z");

    expect(result.decision).toBe("auto-run");
    expect(result.classification).toBe("command-layer");
    expect(result.summary).toContain("Suitability accepted for autonomous execution.");
  });

  it("escalates high-risk issues before branch mutation", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        title: "Rotate webhook authentication secrets",
        body: "Update authentication, secret, and permission handling for webhook delivery.",
        labels: ["security"],
      },
      executionSpec: {
        ...createRun().executionSpec!,
        riskLevel: "high",
      },
    };

    const result = assessIssueSuitability(run, "2026-03-12T07:01:00.000Z");

    expect(result.decision).toBe("escalate");
    expect(result.reasons).toContain("Planner marked this issue as high risk.");
    expect(result.reasons).toContain(
      "Issue text references high-risk areas: auth, secrets, security, permissions.",
    );
    expect(result.summary).toContain("Suitability escalated the issue before branch mutation.");
  });
});
