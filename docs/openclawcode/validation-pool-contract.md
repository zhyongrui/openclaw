# Validation-Pool Contract

The repo-local validation-pool CLI now exposes a stable contract version for
machine-readable issue inventory and reconciliation output.

Contract version:

- `contractVersion: 1`

Commands covered:

- `openclaw code list-validation-issues --json`
- `openclaw code reconcile-validation-issues --json`

Stable top-level fields for `list-validation-issues --json`:

- `contractVersion`
- `owner`
- `repo`
- `state`
- `totalValidationIssues`
- `counts`
- `implementationCounts`
- `templateCounts`
- `issues`

Stable top-level fields for `reconcile-validation-issues --json`:

- `contractVersion`
- `owner`
- `repo`
- `closeImplemented`
- `totalValidationIssues`
- `closableImplementedIssues`
- `closedIssues`
- `nextAction`
- `actions`

Semantics:

- `issues` is the current validation-pool inventory after repo-local
  implementation assessment.
- `actions` is the reconciliation decision list for the current invocation and
  uses:
  - `would-close`
  - `closed`
  - `left-open`
- `nextAction` is the stable summary signal for what an operator or automation
  loop should do next.

Stability boundary:

- the top-level field names listed above are stable for `contractVersion: 1`
- nested entry fields under `issues` and `actions` are also intentionally
  stable for `contractVersion: 1`
- human-readable `implementationSummary` text is descriptive text and should
  not be parsed when a structured field already exists
