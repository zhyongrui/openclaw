# Operator Proof Routine

This document collects the proof cadence for the repo-local operator so setup,
promotion, rollback, and copied-root validation stay repeatable instead of
ad-hoc.

## Routine Proof Buckets

### Setup Proof

Run:

```bash
bash scripts/openclawcode-setup-check.sh --strict --json
```

When validating a newly built local entrypoint, also run:

```bash
bash scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json
```

### Promotion And Rollback Proof

Run on the candidate branch:

```bash
openclaw code promotion-gate-refresh --repo-root . --json
openclaw code rollback-suggestion-refresh --repo-root . --json
```

Record receipts immediately after the git promotion or rollback action:

```bash
openclaw code promotion-receipt-record --repo-root . --actor operator --note "Promoted validated branch" --promoted-branch main --promoted-commit-sha "$(git rev-parse HEAD)" --json
openclaw code rollback-receipt-record --repo-root . --actor operator --note "Rolled back to previous good baseline" --restored-branch main --restored-commit-sha "$(git rev-parse HEAD)" --json
```

### Copied-Root Proof

Use the copied-root path when you want a clean operator-root proof without
touching the long-lived operator state:

- stand up a clean operator root
- run strict setup-check there
- run one low-risk issue through the copied-root operator path
- record the result in the dev log and proof matrix

## Cadence

- after each meaningful upstream sync or promotion candidate:
  - rerun setup-check
  - rerun promotion/rollback artifact refresh
- after any operator-doc or setup-path changes:
  - rerun at least one copied-root proof
- before calling the operator externally usable:
  - confirm the external/live proof rows in `proof-matrix.md`

## Relationship To Other Docs

- `sync-promotion-runbook.md` is the authoritative sync/promotion/rollback
  command sequence
- `fresh-host-install.md` is the fresh-host install packet
- `proof-matrix.md` is the source of truth for which proofs are still pending
