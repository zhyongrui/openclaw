# Codex Install Guide For OpenClawCode

Use this runbook when you want Codex to prepare a fresh machine for
`openclawcode`, then hand the machine back to the user for a real new-repo
validation.

This guide separates:

- what Codex should do automatically
- what the user must do manually

It assumes the target machine is a fresh operator host and that the installed
repository will be this forked OpenClaw checkout that contains
`openclawcode`.

The canonical repository for this runbook is:

- `https://github.com/zhyongrui/openclawcode.git`
- shorthand: `zhyongrui/openclawcode`

Do not search for a separate public `openclawcode` package repository. This
workflow expects the forked OpenClaw checkout above, because that repository
contains:

- `scripts/openclawcode-setup-check.sh`
- `docs/openclawcode/fresh-host-install.md`
- `docs/openclawcode/operator-setup.md`
- the bundled `openclawcode` execution and plugin code

## What Codex Can Do

Codex can do all of the local machine preparation that does not require secret
entry or interactive approval:

1. verify or install prerequisites:
   - `git`
   - `Node >= 22.16.0`
   - `pnpm`
2. clone `https://github.com/zhyongrui/openclawcode.git` to a stable location
   such as `~/pros/openclawcode`
3. run:
   - `pnpm install`
   - `pnpm build`
4. prepare a starter operator config and repo mapping
5. run health checks:
   - `./scripts/openclawcode-setup-check.sh --strict --json`
   - `./scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json`
6. prepare the target repository checkout and show the exact
   `openclaw code run ...` command to use

## What The User Must Do

The user still needs to do anything that requires real credentials, external
ownership, or policy decisions:

1. provide the GitHub token:
   - `GH_TOKEN` or `GITHUB_TOKEN`
2. decide the final operator state directory if the default is not acceptable
3. provide Feishu credentials if chatops must be tested
4. choose the new target repository and ensure the machine can clone it
5. create or approve any GitHub webhook that should point at the fresh host
6. decide whether the first run should be:
   - CLI-only
   - chatops with `/occode-bind`
7. approve any sudo-required package installation if the machine truly needs it

## Prompt To Give Codex

You can give Codex this exact prompt on the fresh machine:

```text
Install and validate openclawcode on this machine.

Requirements:
- use Node >= 22.16.0
- clone https://github.com/zhyongrui/openclawcode.git to ~/pros/openclawcode
- run pnpm install
- run pnpm build
- run:
  - ./scripts/openclawcode-setup-check.sh --strict --json
  - ./scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json

Important repository constraint:
- this is the forked OpenClaw checkout that contains openclawcode
- do not search for a different public repository named openclawcode
- if the checkout does not contain scripts/openclawcode-setup-check.sh, stop and report that the wrong repository was cloned

Do not invent secrets. Stop only when you need:
- GH_TOKEN or GITHUB_TOKEN
- Feishu credentials
- the final target repository path

When finished, report:
- node version
- pnpm version
- codex version
- whether build passed
- whether strict setup-check passed
- whether built-startup proof passed
- the exact next commands for binding or running against a new target repo
```

## Minimal Install Flow

The smallest successful machine bootstrap looks like this:

1. Codex clones `zhyongrui/openclawcode`.
2. Codex runs `pnpm install`.
3. Codex runs `pnpm build`.
4. The user provides `GH_TOKEN` or `GITHUB_TOKEN`.
5. Codex runs strict setup-check.
6. Codex runs built-startup setup-check.
7. Codex prepares the target repo mapping.
8. The user chooses CLI-only or chatops validation.

## After OpenClawCode Is Installed

Once installation succeeds, yes: you can point `openclawcode` at a new
repository and use it to develop there.

There are two supported paths.

### Path A: CLI-only

Use this when you want the fastest proof on a new machine.

1. clone the new target repo locally
2. add a repo entry in the operator config, or pass the repo information
   directly to the CLI
3. run:

```bash
openclaw code blueprint-init --title "Project Blueprint" --goal "Describe the target goal"
openclaw code run --issue 123 --owner <owner> --repo <repo> --repo-root <absolute-path-to-repo>
```

### Path B: ChatOps

Use this when you want the real operator flow.

1. bring up the local gateway
2. connect the real chat surface
3. bind the repo from the desired conversation:

```text
/occode-bind <owner>/<repo>
```

4. then use:

```text
/occode-intake
/occode-start <owner>/<repo>#<issue>
```

## Minimal New-Repo Validation

After installation, the first test on a new repository should be narrow:

1. run strict setup-check again after repo config is in place
2. verify the binding or repo mapping appears in operator status
3. run one low-risk issue
4. verify the result is one of:
   - `ready-for-human-review`
   - `completed-without-changes`
   - a clearly explained `escalated`

Do not start with webhook auto-mode on a brand-new machine before one narrow
manual proof has passed.

## Related Docs

- `fresh-host-install.md`
- `operator-setup.md`
- `sample-operator-config.md`
- `release-runbook.md`
- `proof-matrix.md`
