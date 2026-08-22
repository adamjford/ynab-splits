---
name: herdr-finish-worktree
description: Finish delegated project work from the parent Herdr workspace after the child reports completion and the user explicitly approves merging.
---

# Finish delegated worktree work

Run this skill from the **parent workspace repository root**. Never run it from
the linked worktree. The parent workspace agent does not monitor or wait on the
child workspace agent. The child must independently report completion to the
parent first.

## Parent-pane prerequisite

The current pane MUST be inside the parent Herdr workspace. The helper reads
the injected `HERDR_WORKSPACE_ID`; it does not infer the parent from UI focus
or from a child pane's Git directory. Before invoking it, verify:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID"
herdr worktree list --workspace "$HERDR_WORKSPACE_ID"
```

The listed `source_checkout_path` and `repo_root` must be this repository root.
If `HERDR_WORKSPACE_ID` is missing or points at another workspace, stop, return
to a pane in the parent workspace, and retry there. Do not substitute a child
workspace ID or interpret this failure as a Git branch problem.

## Preconditions

Require all of these before proposing a merge:

- the child workspace agent has supplied a final handoff addressed to the
  parent;
- the handoff names the branch and final (possibly rewritten) commit IDs, gives
  exact check results from after the rebase, lists remaining risks, confirms
  the branch was rebased onto the current local `main` (or the exact
  intentionally selected non-`main` parent branch), states the rebase
  succeeded, and says the child workspace checkout is clean;
- the parent identifies the branch or absolute linked-worktree path;
- the parent checkout has no unrelated uncommitted changes.

Do not infer completion from a pane being idle, from Herdr status, or from a
clean branch without the child's report. Do not call `herdr agent wait`, poll
child panes, or inspect child-agent lifecycle state.

## Approval-gated finish sequence

1. Capture the child's report in the current conversation. If it is missing,
   stop and ask the child/user to provide it; do not monitor the child.
2. Run the project-local helper **without** `--approve`:

   ```bash
   bash .omp/skills/herdr-finish-worktree/scripts/finish-worktree.sh \
     --branch work/<slug>
   ```

   Use `--path /absolute/path` instead when branch selection is ambiguous. The
   helper requires `HERDR_WORKSPACE_ID`, verifies that it names the current
   parent checkout, and reads worktrees with:

   ```bash
   herdr worktree list --workspace "$HERDR_WORKSPACE_ID"
   ```

   This performs read-only parent/worktree checks and emits the exact proposed
   merge and workspace removal. It does not merge or remove anything.
3. Show the proposed branch, parent branch, merge message, and worktree path to
   the user. Ask for explicit approval. A request to inspect or finish the
   work is not approval to merge.
4. Only after the user explicitly approves that exact merge, rerun the helper
   with `--approve` (and the same selector/message):

   ```bash
   bash .omp/skills/herdr-finish-worktree/scripts/finish-worktree.sh \
     --branch work/<slug> \
     --approve
   ```

5. After approval, the helper performs the exact parent-side merge:

   ```bash
   git merge --no-ff --no-edit -m 'Merge <branch> into <parent>' <branch>
   ```

   On success it removes the linked checkout and its workspace with:

   ```bash
   herdr worktree remove --workspace <child-workspace-id>
   ```

   It never uses `--force`. The local branch remains available; this workflow
   does not push or delete it.
6. After a successful merge, run the repository's applicable verification from
   the parent checkout. Report the exact command and result. If the merge
   conflicts, leave the conflict state intact, do not remove the worktree, and
   report the blocker for resolution.

## Safety boundaries

- Parent-only invocation is mandatory. The helper requires
  `HERDR_WORKSPACE_ID`, verifies that its source checkout and the current
  repository root are the same parent checkout, and refuses to finish the
  parent workspace itself.
- The helper refuses dirty parent or child checkouts, branches that are not
  based on the current parent branch tip, and branches with no new commits. It
  never stashes, resets, force-removes, pushes, or deletes data.
- User approval is enforced by the helper's required `--approve` flag. Never
  add that flag speculatively or treat a child report as merge authorization.
- Use Herdr for worktree creation/removal and workspace lifecycle. Do not use
  raw `git worktree remove` or manually close plugin-created tabs and panes.
- Do not use operational databases, real credentials, real YNAB writes, or
  tracked handoff artifacts while completing the workflow.
