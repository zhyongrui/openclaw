# OpenClaw Code Proof Matrix

## Completed Repo-Local Proofs

- strict setup-check and built-startup readiness
- issue-driven local runs with worktrees, build, verify, PR publication, and
  merge-policy explanation
- provider pause and compact failure diagnostics
- blueprint-first repo-local artifacts:
  - blueprint
  - work items
  - discovery
  - role routing
  - stage gates
  - promotion / rollback artifacts and receipts
- policy machine-readable snapshot and guarded merge behavior

## Completed Sync-Branch Proofs

- refreshed upstream sync branches that pass:
  - targeted conflict tests
  - `vitest.openclawcode`
  - `pnpm build`

## Still Pending Live Proofs

- fresh-host external install proof
- low-risk merged run on the long-lived operator after the latest policy hardening
- blocked or escalated proof on the latest promoted baseline
- fallback-model live proof on a real second model
- blueprint-first live proof end-to-end from goal discussion to merged PR

## How To Use This Matrix

- treat repo-local proofs as engineering confidence, not production proof
- treat sync-branch proofs as promotion readiness, not long-lived operator proof
- do not mark external/operator checklists complete until the live proof row is
  filled in with a dated run
