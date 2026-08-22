---
name: herdr-start-worktree
description: Start delegated project work in a new Herdr Git worktree from the parent checkout, preserving the repository's workspace-manager layout.
---

# Start delegated worktree work

Run this skill from the **parent workspace repository root**. Never run it from a
linked worktree. The parent workspace agent starts the child and then returns;
it does not monitor the child or wait for its task to finish.

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

## Start sequence

1. Derive a new local branch from the task. Prefer a short descriptive branch
   name; use `work/<slug>` when the project has no stronger convention. Do not
   reuse an existing branch.
2. Choose the worktree name. By default it is the final branch path component;
   pass `--worktree-name` when the desired name differs.
3. Compose the child prompt before starting it. Include:
   - objective;
   - affected behavior and exact scope;
   - constraints and non-goals;
   - acceptance criteria;
   - required focused and broader verification.
4. Run the project-local mechanical helper from the parent root:

   ```bash
   bash .omp/skills/herdr-start-worktree/scripts/start-worktree.sh \
     --branch work/<slug> \
     --worktree-name <worktree_name> \
     --start-agent \
     --agent-kind codex
   ```

   Add `--base REF`, `--label TEXT`, or `--path /absolute/path` only when the
   task requires them. The helper requires the injected
   `HERDR_WORKSPACE_ID`, verifies that it names this repository's parent
   checkout, and invokes the exact Herdr create form:

   ```bash
   herdr worktree create --workspace "$HERDR_WORKSPACE_ID" \
     --branch work/<slug> --base REF --label TEXT --no-focus
   ```

   It never uses the focused pane to select the parent. It leaves focus in the
   parent workspace.
5. Let `herdr-plugin-workspace-manager` create its configured tabs and panes.
   Do not manually split panes, create replacement tabs, or impose a second
   layout. The helper only waits briefly for plugin startup; it never waits for
   delegated work to complete. It renames the single plugin-created agent to
   `omp-<worktree_name>`; if there are multiple configured agents, choose the
   task agent and rename it with Herdr before prompting.
6. Prompt the child using Herdr, without a completion wait:

   ```bash
   herdr agent prompt omp-<worktree_name> '<complete child prompt>' --timeout 30000
   ```

   Do not add `--wait`; do not run `herdr agent wait`; do not poll pane output.
   Use `herdr agent get` only when the initial prompt itself is rejected or
   blocked, then stop and surface the block instead of answering it silently.
7. Tell the child to work entirely in its linked checkout, commit its changes,
   run the required checks, and report back to the parent when complete. Its
   final handoff must state the branch, commit(s), checks and results, remaining
   risks, and whether the checkout is clean. Use the child agent's final
   response as the handoff; do not use `herdr notification show`, desktop
   notifications, or any other interrupting signal because it can disrupt
   active parent work.

   The parent acts only after that child report and a separate user decision to
   merge. It must not infer completion from idle/unknown terminal state.

## Safety boundaries
- Parent-only invocation is mandatory. The helper requires
  `HERDR_WORKSPACE_ID`, verifies that its source checkout and the current
  repository root are the same parent checkout, and rejects linked
  worktrees, detached parents, or existing local branches.
- Use Herdr worktree lifecycle commands, not raw `git worktree add` or manual
  workspace cleanup.
- Never push, deploy, mutate YNAB, access real credentials, or use the
  operational `data/` database as part of delegation.
- The helper does not merge anything. Finishing and merging is a separate skill
  requiring an explicit user approval.
