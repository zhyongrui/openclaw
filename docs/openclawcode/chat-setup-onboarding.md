# Chat-Driven OpenClawCode Setup

## Goal

Let an operator finish the first `openclawcode` setup steps from chat after
`openclaw` itself is already installed and connected to a real conversation
surface such as Feishu.

The first user-visible milestone is:

1. the operator sends `/occode-setup`
2. OpenClaw checks whether GitHub auth is already ready on the host
3. if auth is missing, OpenClaw starts the host-side GitHub device flow
4. OpenClaw sends the verification URL and one-time code back into chat
5. the operator completes approval in the browser
6. OpenClaw resumes setup from chat without asking the operator to paste a
   token into chat

## Why This Matters

The current low-touch bootstrap is already much better than manual setup, but
the operator still has to leave chat, think in terms of local shell commands,
and manually bridge the GitHub login step.

That is not the right long-term surface for a chat-native operator product.

If `openclaw` is already the runtime living in chat, then `openclawcode`
configuration should start there too.

## Product Contract

### What chat should own

- starting the setup session
- showing the exact next human action
- remembering which chat is doing setup
- remembering whether GitHub auth is still pending or already ready
- guiding the handoff into repo selection and bootstrap

### What the host should own

- running the local GitHub authentication flow
- storing the resulting GitHub credential in the local `gh` auth store
- executing `openclaw code bootstrap`
- writing local operator state and repo state

## MVP Command Surface

### `/occode-setup existing owner/repo`

Select an existing GitHub repository for this chat-native setup session.

Behavior:

- if GitHub auth is missing:
  - remember the chosen existing repo
  - start the GitHub device flow
  - continue after browser approval
- if GitHub auth is ready:
  - validate that the repo is accessible with the current login
  - persist it as the selected repo for this chat
  - hand off into bootstrap

### `/occode-setup new repo-name`

Create a new GitHub repo for this setup session.

Behavior:

- if GitHub auth is missing:
  - remember the requested repo name
  - start the GitHub device flow
  - continue after browser approval
- if GitHub auth is ready:
  - resolve the authenticated GitHub owner
  - create the repo on the host through `gh repo create`
  - persist the created repo for this chat
  - hand off into bootstrap

### `/occode-setup [owner/repo]`

Starts or resumes setup for the current chat.

Behavior:

- treat plain `owner/repo` as the `existing` path for backward compatibility
- when no project selection is given, only handle the auth step

### `/occode-setup-status`

Shows the current setup session for the current chat.

Behavior:

- if auth is still pending:
  - show the current device-flow URL and code again
  - tell the operator to finish approval in the browser
- if auth is now ready:
  - transition the session to authenticated
  - complete any pending existing-repo validation or new-repo creation
  - show the next repo/bootstrap action
- if no setup session exists:
  - explain how to start with `/occode-setup`

## Session Model

Persist one setup session per `(notifyChannel, notifyTarget)`.

Initial MVP state:

- `awaiting-github-device-auth`
- `github-authenticated`

Persisted fields:

- `notifyChannel`
- `notifyTarget`
- `projectMode`
- `repoKey`
- `pendingRepoName`
- `stage`
- `githubAuthSource`
- `createdAt`
- `updatedAt`
- `githubDeviceAuth`
  - `pid`
  - `logPath`
  - `userCode`
  - `verificationUri`
  - `startedAt`
  - `completedAt`
  - `failureReason`

This belongs in the existing ChatOps store so chat setup survives process
restart and uses the same durability model as approvals, reroutes, and intake
drafts.

## GitHub Auth Design

### Desired operator experience

The operator should not be told to manually open a terminal and run
`gh auth login`.

Instead:

1. OpenClaw starts the device flow on the host
2. OpenClaw extracts the GitHub verification URL and one-time code
3. OpenClaw sends both back into the active chat
4. the operator chooses the GitHub account in the browser
5. OpenClaw detects when host auth is now ready

### MVP implementation choice

The MVP should still use the host `gh` credential store as the source of truth,
because the existing onboarding code already detects readiness from:

- `GH_TOKEN`
- `GITHUB_TOKEN`
- `gh auth token`

For the first implementation, the practical requirement is:

- the host process launches `gh auth login --web`
- the plugin captures the emitted device-flow instructions
- the chat command replays those instructions safely

The operator never pastes tokens into chat.

## State Machine

1. `idle`
   - no setup session yet
2. `awaiting-github-device-auth`
   - GitHub auth not ready
   - device flow started on host
   - chat shows verification URL and code
3. `github-authenticated`
   - host auth is now ready
   - chat can validate an existing repo or create a new repo
   - chat can then move into bootstrap handoff

Future states can extend this into:

- `repo-selected`
- `bootstrap-running`
- `bootstrap-blocked`
- `chat-bound`
- `ready-for-intake`

## Security Rules

- do not ask the user to paste a GitHub token into chat
- prefer a private or direct chat for setup commands
- do not copy the device code into long-term docs or dev logs
- store only the minimum temporary session data needed for resume or poll
- clear temporary device-flow state after auth succeeds

## Near-Term Follow-Up

After GitHub auth is stable in chat, the next slice should extend the same
session into:

1. exact bootstrap progress and next-action reporting in chat
2. optional auto-bind of the current conversation as the repo notification
   target
3. blueprint draft generation for `new-project` before repo creation
4. blueprint alignment against repo reality for `existing-repo`

That is the path from "chat can start auth" to "chat can complete first-run
configuration end-to-end".
