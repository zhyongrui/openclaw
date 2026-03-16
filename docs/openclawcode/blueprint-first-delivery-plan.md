# Blueprint-First Delivery Plan

## Purpose

This is the execution plan for moving `openclawcode` from an issue-first coding
operator to a blueprint-first autonomous development system.

It translates the gap analysis in `blueprint-first-orchestration.md` into
implementation phases that can be shipped, tested, and documented one slice at
a time.

For the lower-level mapping of existing `openclaw` capabilities onto those
phases, see `openclaw-capability-mapping.md`.

## Target End State

The finished system should support this loop:

1. a user describes a project goal
2. the system asks clarifying questions when needed
3. the agreed target is written into a fixed project blueprint document
4. the system derives or discovers work items from that blueprint
5. the execution layer chooses Codex, Claude Code, or both by role
6. humans can intervene at any major stage, but the system continues
   autonomously when they do not

## Delivery Phases

### Phase B1: Blueprint Foundation

Status: in progress and partially landed

Deliverables:

- fixed blueprint file path: `PROJECT-BLUEPRINT.md`
- stable blueprint lifecycle statuses:
  - `draft`
  - `clarified`
  - `agreed`
  - `active`
  - `superseded`
- repo-local CLI surface:
  - `openclaw code blueprint-init`
  - `openclaw code blueprint-show`
  - `openclaw code blueprint-set-status`
- machine-readable blueprint inspection through `--json`

Acceptance:

- a repo can create the blueprint scaffold without manual copy-paste
- operators can inspect the blueprint path and lifecycle state
- operators can record an explicit `agreed` checkpoint

### Phase B2: Goal Discussion Loop

Status: partially started through repo-local clarification reporting

Deliverables:

- chat or CLI-native goal intake before issue creation
- clarification prompts when the goal is underspecified
- proactive suggestions while the goal is still forming
- explicit confirmation that the blueprint is ready to become active

Acceptance:

- the system does not need a pre-written GitHub issue to start shaping work
- an ambiguous request can be clarified into a blueprint without manual docs
  editing

Current foothold:

- `openclaw code blueprint-clarify` now produces deterministic clarification
  questions and proactive suggestions from the current blueprint scaffold

### Phase B3: Work Item Decomposition

Status: open

Deliverables:

- first internal work-item abstraction broader than GitHub issues
- blueprint-to-work-item decomposition
- support for planned work items and discovered work items
- projection from work items into GitHub issues when needed

Acceptance:

- the system can derive work items from the blueprint instead of assuming they
  already exist on GitHub

### Phase B4: Discovery Pipeline

Status: open

Deliverables:

- first non-validation discovery source
- evidence capture and dedupe
- priority and severity scoring
- draft work-item creation from incidents or drift

Candidate inputs:

- failing tests
- setup-check regressions
- provider pauses
- upstream sync conflicts
- docs drift

### Phase B5: Provider Role Routing

Status: open

Deliverables:

- provider-neutral role model:
  - planner
  - coder
  - reviewer
  - verifier
  - doc-writer
- adapters for Codex and Claude Code
- routing and fallback rules by role

Acceptance:

- one stage can use Codex while another uses Claude Code without changing the
  higher-level orchestration model

### Phase B6: Stage-Level Human Handoff

Status: open

Deliverables:

- plan approval or edit
- manual worktree takeover
- provider switch mid-run
- structured resume after manual edits
- explicit merge or promotion override flow

Acceptance:

- every major stage has a documented human intervention path
- autonomous execution can resume from that intervention without losing state

### Phase B7: Proofs And Productization

Status: open

Deliverables:

- blueprint-first live proof on the long-lived operator
- promotion and rollback guidance for blueprint-aware releases
- release-facing docs for external operators

Acceptance:

- another operator can stand the system up, write a blueprint, and run the
  same flow without tribal knowledge

## Current Slice Sequence

The near-term implementation order is:

1. finish Phase B1 foundation
2. add the first goal-discussion surface
3. add blueprint-to-work-item decomposition
4. add provider-role routing
5. add the first general discovery source
6. add stage-level human handoff controls

## Done In The Current Slice

- fixed the project blueprint path at `PROJECT-BLUEPRINT.md`
- defined the first markdown schema and lifecycle statuses
- added CLI commands to create, inspect, and update blueprint state
