# OpenClaw Code Docs

This directory contains product-specific documents for `openclawcode`.

Recommended reading order:

1. `idea-outline.md`
2. `mvp.md`
3. `mvp-spec-v1.md`
4. `architecture.md`
5. `development-plan.md`
6. `workflows.md`
7. `specs.md`
8. `openclaw-strategy.md`
9. `openclaw-implementation-plan.md`
10. `upstream-sync-policy.md`
11. `mvp-runbook.md`
12. `webhook-operations.md`

Development logs live in `dev-log/`.

## Current Status

As of 2026-03-11, the repository includes a working `openclawcode` issue-driven
loop with:

- workflow state, persistence, and isolated worktree management
- a GitHub-backed issue webhook intake path with delivery-id deduplication
- durable queue ingestion and background execution in the bundled OpenClaw
  plugin
- chat-facing operator commands:
  - `/occode-start`
  - `/occode-status`
  - `/occode-inbox`
  - `/occode-skip`
  - `/occode-sync`
  - `/occode-bind`
  - `/occode-unbind`
- a local builder/verifier runtime adapter built on top of OpenClaw's embedded
  agent entrypoint
- an `openclaw code run ...` CLI path for issue-driven execution
- draft PR publishing and guarded merge hooks in the workflow service layer
- GitHub-side status healing for review, merged, and closed-without-merge PR
  outcomes
- rerun continuity that reuses an existing open PR for the same issue branch
- real end-to-end validation against this repository, including a webhook-driven
  issue run that opened, merged, and closed automatically

Still pending for a fuller product loop:

- event-driven `pull_request` / `pull_request_review` webhook intake and chat
  push notifications
- first-class request-changes rerun artifacts and a dedicated rerun control path
- stronger suitability/risk gating ahead of autonomous execution
- richer operator ledger and notification visibility
- broader setup, runbook, and policy-doc polish
