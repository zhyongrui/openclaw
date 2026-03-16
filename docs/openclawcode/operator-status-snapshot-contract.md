# Operator Status Snapshot Contract

`openclaw code operator-status-snapshot-show --json` exposes a stable
machine-readable view of the operator chat state that backs `/occode-status`,
`/occode-inbox`, and related gate-driven controls.

Contract version:

- `contractVersion: 1`

Current top-level fields:

- `contractVersion`
- `generatedAt`
- `stateDir`
- `statePath`
- `exists`
- `pendingApprovalCount`
- `manualPendingApprovalCount`
- `executionStartGatedApprovalCount`
- `pendingIntakeDraftCount`
- `manualTakeoverCount`
- `queuedRunCount`
- `currentRunPresent`
- `trackedIssueCount`
- `repoBindingCount`
- `githubDeliveryCount`
- `providerPauseActive`
- `currentRun`
- `providerPause`
- `pendingApprovals`
- `pendingIntakeDrafts`
- `manualTakeovers`
- `repoBindings`
- `issueSnapshots`
- `repos`

Semantics:

- `pendingApprovals` reflects issues waiting for either explicit manual approval
  or an `execution-start` gate decision.
- `issueSnapshots` is the stable sorted list form of the tracked
  `statusSnapshotsByIssue` map and is ordered by newest `updatedAt` first.
- `repos` summarizes the per-repo operator state visible in chat:
  tracked issues, pending approvals, intake drafts, takeovers, queued/current
  work, and final issue stages.
- `currentRun` mirrors the queued run request currently being executed, when
  one exists.
- `providerPause` mirrors the active provider-pause record when the queue is
  paused after repeated transient provider failures.

Stability boundary:

- top-level field names listed above are part of the stable contract
- array entry object shapes are also intentionally stable for `contractVersion: 1`
- human-readable `status` strings inside `issueSnapshots` remain descriptive
  text and should not be parsed for automation when a structured field already
  exists

Usage:

```bash
openclaw code operator-status-snapshot-show --json
openclaw code operator-status-snapshot-show --state-dir ~/.openclaw --json
```
