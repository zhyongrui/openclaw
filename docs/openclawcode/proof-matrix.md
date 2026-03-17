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

- fresh-host external-style host merged low-risk proof
- fresh-host external-style host rerun proof
- fallback-model live proof on a real second model
- blueprint-first live proof end-to-end from goal discussion to merged PR

## External-Usable Proof Gate

Do not call the operator "externally usable" until all of these rows have a
dated proof entry:

1. fresh-host zero-to-bind proof
2. fresh-host zero-to-merged low-risk run proof
3. fresh-host zero-to-escalated-path proof
4. fresh-host zero-to-rerun-path proof
5. latest promoted baseline merged low-risk proof
6. latest promoted baseline no-op proof
7. latest promoted baseline blocked or escalated proof
8. fallback-model live proof, if a second model is configured
9. blueprint-first end-to-end proof from goal discussion to merged PR

Current status on 2026-03-17:

- repo-local proof rows: complete
- sync-branch proof rows: complete on `sync/upstream-2026-03-17`
- external/operator proof rows:
  - fresh zero-to-bind: complete
  - fresh zero-to-escalated: complete
  - latest promoted baseline merged low-risk: complete via `origin/main @ 22e43ad3cb` (`feat: implement issue #130 (#135)`)
  - latest promoted baseline no-op: complete via run `zhyongrui-openclawcode-134-1773739257883`
  - latest promoted baseline escalated: complete via run `zhyongrui-openclawcode-132-1773739717720`
  - still pending:
    - fresh zero-to-merged low-risk
    - fresh zero-to-rerun
    - fallback-model live proof
    - blueprint-first end-to-end proof

## How To Use This Matrix

- treat repo-local proofs as engineering confidence, not production proof
- treat sync-branch proofs as promotion readiness, not long-lived operator proof
- do not mark external/operator checklists complete until the live proof row is
  filled in with a dated run
