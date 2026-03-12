import { describe, expect, it } from "vitest";
import { buildValidationIssueDraft, listValidationIssueTemplates } from "./validation-issues.js";

describe("validation issue templates", () => {
  it("builds command-json-number drafts from the required field metadata", () => {
    const draft = buildValidationIssueDraft({
      template: "command-json-number",
      fieldName: "publishedPullRequestNumber",
      sourcePath: "draftPullRequest.number",
    });

    expect(draft).toMatchObject({
      template: "command-json-number",
      issueClass: "command-layer",
      title: "[Feature]: Expose publishedPullRequestNumber in openclaw code run --json output",
    });
    expect(draft.body).toContain("`publishedPullRequestNumber: number | null`");
    expect(draft.body).toContain("`draftPullRequest.number`");
  });

  it("builds high-risk webhook precheck drafts with the default summary", () => {
    const draft = buildValidationIssueDraft({
      template: "webhook-precheck-high-risk",
    });

    expect(draft.title).toBe(
      "[Validation]: Webhook intake should precheck-escalate auth and secret issue",
    );
    expect(draft.body).toContain("precheck-escalates");
    expect(draft.body).toContain("no pending approval entry is created");
  });

  it("requires the template-specific command-json options", () => {
    expect(() =>
      buildValidationIssueDraft({
        template: "command-json-boolean",
        fieldName: "verificationHasSignals",
      }),
    ).toThrow("--source-path is required for this template");
  });

  it("lists the supported validation templates in a stable order", () => {
    expect(listValidationIssueTemplates()).toEqual([
      {
        id: "command-json-boolean",
        issueClass: "command-layer",
        description: "Seed a low-risk JSON boolean field issue derived from a nested array path.",
      },
      {
        id: "command-json-number",
        issueClass: "command-layer",
        description:
          "Seed a low-risk JSON number-or-null field issue derived from nested metadata.",
      },
      {
        id: "operator-doc-note",
        issueClass: "operator-docs",
        description: "Seed a low-risk docs or operator note issue for one specific file.",
      },
      {
        id: "webhook-precheck-high-risk",
        issueClass: "high-risk-validation",
        description: "Seed a high-risk webhook precheck validation issue for escalation routing.",
      },
    ]);
  });
});
