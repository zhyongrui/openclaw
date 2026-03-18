# Development Plan: Chat-Native Autonomous Engineering

This is the execution companion to
`chat-native-autonomous-engineering.md`.

It turns the product direction into a near-term implementation sequence that
can be consumed in slices.

## Objective

Move `openclawcode` from:

- issue-driven execution with blueprint scaffolding

to:

- a blueprint-driven, chat-supervised, multi-agent engineering loop that can
  keep advancing a repository toward its agreed target.

## Near-Term Milestones

### Milestone 1: Empty-Repo Blueprint Bootstrap

Problem:

- empty repos currently need a placeholder test command to survive bootstrap

Outcome:

- bootstrap handles empty repos as a first-class blueprint-first case

Tasks:

- detect empty repo state during bootstrap
- stop requiring inferred test commands for empty repos
- persist an explicit empty-repo / blueprint-first signal in bootstrap output
- update onboarding handoff text for new repos
- add tests for empty repo bootstrap behavior

Exit signal:

- a new repo can be onboarded and bootstrapped without fake test commands

### Milestone 2: Blueprint-Driven Next-Work Selection

Problem:

- the system can execute a chosen issue, but not yet sustain forward motion

Outcome:

- the system can select the next work item from blueprint-backed state

Tasks:

- inspect blueprint, work-items, discovery, and gates together
- define "next actionable work item" selection rules
- distinguish:
  - ready to execute
  - blocked on human
  - blocked on missing clarification
  - blocked on policy
- expose the decision in machine-readable output

Exit signal:

- the system can explain why a specific next work item was chosen or why it
  cannot continue

### Milestone 3: Issue Materialization From Work Items

Problem:

- work items and GitHub issues are not yet treated as separate layers

Outcome:

- blueprint-backed work items can become execution issues when needed

Tasks:

- define when a work item needs a GitHub issue
- add issue materialization rules
- avoid duplicate issue creation
- persist the link between work item id and GitHub issue id

Exit signal:

- the system can create or reuse the correct issue for the selected work item

### Milestone 4: Role-Based Agent Routing

Problem:

- Codex and Claude Code are not yet fully formalized as first-class role
  backends

Outcome:

- planner / coder / reviewer / verifier become normal configurable roles

Tasks:

- lock the role contracts
- define per-role backend configuration
- persist which role used which backend
- support safe reroute and rerun behavior
- document role routing for operators

Exit signal:

- one real workflow run can use different backends for different roles while
  remaining fully auditable

### Milestone 5: Chat-Native Project Progress

Problem:

- current status surfaces are stronger at run reporting than project reporting

Outcome:

- chat surfaces show blueprint-aware project progress

Tasks:

- expose active workstream summary
- expose current blueprint status and revision
- expose active issue and assigned role backends
- expose blockers and next steps

Exit signal:

- a user in chat can understand where the project stands without opening the
  repo or reading raw artifacts

### Milestone 6: Autonomous Progress Loop

Problem:

- the system still depends on a human to keep handing it work

Outcome:

- the system can keep going until it hits a real gate

Tasks:

- add a loop that:
  - reads blueprint-backed state
  - chooses next work
  - creates or selects the issue
  - executes
  - updates artifacts
  - repeats
- stop automatically on any unresolved gate
- surface loop status in chat and machine-readable artifacts

Exit signal:

- the operator can leave the system running and return to meaningful progress
  or a precise blocked state

## Validation Strategy

Each milestone should include:

- focused unit or command tests
- machine-readable output assertions where relevant
- at least one updated operator-facing doc
- a dev-log entry with exact validation commands

Live proofs should be added when the milestone changes real operator behavior.

## Guardrails

The plan must preserve:

- explicit human gates around risky work
- auditable GitHub-backed execution units
- deterministic reruns and artifact history
- role-specific boundaries between planning, coding, review, and verification

## Recommendation

The next implementation slice should be Milestone 1:

- empty-repo bootstrap as a true blueprint-first path

It is the shortest path to aligning the new onboarding flow with the real
product thesis.
