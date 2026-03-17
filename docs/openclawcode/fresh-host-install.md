# OpenClaw Code Fresh-Host Install

If you want Codex to perform this bootstrap on the fresh machine, use
`codex-openclawcode-install.md` alongside this document.

## Prerequisites

- git
- Node and pnpm versions supported by the current repo
- a writable operator state directory
- GitHub token with least-privilege scopes
- Feishu app credentials if chat control is required

## Required Environment

- `GH_TOKEN` or `GITHUB_TOKEN`
- `OPENCLAW_STATE_DIR` if the default operator state directory is not desired
- optional:
  - `OPENCLAWCODE_MODEL_FALLBACKS`
  - adapter-specific agent env vars for reroute-capable roles

## Install Path

1. clone the repo
2. install dependencies
3. build once
4. run strict setup-check
5. configure the OpenClaw plugin repo binding
6. validate one narrow issue locally before relying on webhook auto mode

## Lowest-Touch Fresh-Host Goal

The intended operator experience should eventually be:

1. Codex installs `zhyongrui/openclawcode`
2. the user logs into GitHub once
3. the user names the target repo
4. `openclaw code bootstrap --repo owner/repo` handles the rest

That full product path does not exist yet.

Today, the shortest practical path is:

1. Codex clones and builds this repo
2. the user provides one GitHub token
3. Codex writes the operator env file and bundled plugin repo config
4. Codex runs strict setup-check and built-startup proof
5. the user performs one narrow validation:
   - CLI-only, or
   - one chat-side bind / read command if ChatOps is already connected

See `single-login-bootstrap-proposal.md` for the target end state.

## Expected Healthy Outputs

- `setup-check --strict --json` returns all required readiness signals
- `operator-status-snapshot-show --json` shows the repo binding
- one local issue run reaches `ready-for-human-review` or a clearly explained
  blocked/escalated state

Exact proof-gate expectations:

- strict setup-check:
  - gateway reachable
  - route probe ready
  - built-startup proof ready when requested
- binding:
  - repo binding appears in operator-status snapshot
- low-risk run:
  - build and verification succeed
  - PR or merge path is explicit
- escalated path:
  - no branch mutation happens before the escalation is recorded
- rerun path:
  - rerun context is preserved and visible in run JSON or status

## Common Failure Signatures

- webhook route unreachable
- GitHub token lacks issue or pull-request write scope
- model inventory cannot enumerate providers
- provider pause remains active after repeated internal failures
