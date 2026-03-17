# Chat-Native Intake Styles

## Supported Prompt Styles

These are the styles that the current chat intake flow is meant to handle well:

- one-line narrow requests
  - example: "Expose `buildSummaryPresent` in `openclaw code run --json`"
- short request plus short body
  - example:
    - first line: "Clarify provider pause behavior in operator docs"
    - following lines: one or two concrete constraints
- issue-title-first requests that already name the repo and scope
- docs-only requests that point to one specific document
- command-layer JSON mirror requests that already identify:
  - field name
  - nested source path
  - expected scalar/boolean shape

## Supported But Human-Reviewed

These are accepted, but should be expected to pause for clarification or manual
approval:

- mixed-scope requests
- requests with open questions
- requests that mention policy changes
- requests that are broad enough to require multiple work items
  - the current intake flow now proposes multiple scoped draft variants when it
    can split an ambiguous one-line request safely

## Unsupported Or Intentionally Blocked Styles

These should not be treated as direct autonomous-safe intake:

- secret rotation or credential work
- auth, permissions, RBAC, billing, or infra changes
- "refactor the whole repo" requests
- vague requests with no repo-local target
- requests that require hidden organizational context
- requests that bundle multiple unrelated tasks into one ambiguous block

## Current Narrowing Flow

When a one-line intake request is narrow enough, `openclawcode` will generate a
single pending draft and ask for confirmation.

When a one-line intake request is obviously mixed-scope, the current flow can
also propose multiple scoped variants. In chat, the operator can:

- inspect the suggested variants in the pending draft message
- pick one with `/occode-intake-choose owner/repo <index>`
- keep refining with `/occode-intake-edit`
- confirm with `/occode-intake-confirm`
