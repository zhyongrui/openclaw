# OpenClaw Code Fresh-Host Install

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

## Expected Healthy Outputs

- `setup-check --strict --json` returns all required readiness signals
- `operator-status-snapshot-show --json` shows the repo binding
- one local issue run reaches `ready-for-human-review` or a clearly explained
  blocked/escalated state

## Common Failure Signatures

- webhook route unreachable
- GitHub token lacks issue or pull-request write scope
- model inventory cannot enumerate providers
- provider pause remains active after repeated internal failures
