#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: finish-worktree.sh (--branch BRANCH | --path PATH) [options]

Merge a clean linked Herdr worktree into the current parent checkout only
after explicit user approval, then remove that linked worktree through Herdr.
The command must be run from the parent repository root, not from the linked
worktree.

Options:
  --branch BRANCH          Linked worktree branch to merge
  --path PATH              Linked worktree checkout path
  --message TEXT           Merge commit message
  --approve                Required after the user explicitly approves merge
  --help                   Show this help
EOF
}

die() {
  printf 'finish-worktree: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_parent_checkout() {
  [[ "${HERDR_ENV:-}" == 1 ]] || die 'HERDR_ENV=1 is required; run this from a Herdr-managed pane'
  parent_workspace_id="${HERDR_WORKSPACE_ID:-}"
  [[ -n "$parent_workspace_id" ]] || die 'HERDR_WORKSPACE_ID is required; target the parent Herdr workspace explicitly'

  parent="$(pwd -P)"
  git_root="$(git rev-parse --show-toplevel 2>/dev/null)" || die 'current directory is not a Git checkout'
  [[ "$git_root" == "$parent" ]] || die "run from the parent repository root: $git_root"
  [[ "$(git rev-parse --is-inside-work-tree)" == true ]] || die 'parent checkout is not a worktree'
  git_dir="$(git rev-parse --absolute-git-dir)"
  [[ "$git_dir" == "$parent/.git" ]] || die 'the current checkout is already a linked worktree'
  parent_branch="$(git branch --show-current)"
  [[ -n "$parent_branch" ]] || die 'parent checkout is detached; check out the parent branch first'

  parent_workspace_snapshot="$(herdr worktree list --workspace "$parent_workspace_id")"
  workspace_source_root="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("repo_root", ""))' <<<"$parent_workspace_snapshot")"
  workspace_source_path="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("source_checkout_path", ""))' <<<"$parent_workspace_snapshot")"
  workspace_source_id="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("source_workspace_id", ""))' <<<"$parent_workspace_snapshot")"
  [[ "$workspace_source_id" == "$parent_workspace_id" ]] || die "Herdr workspace $parent_workspace_id is not the parent workspace"
  [[ "$workspace_source_root" == "$parent" && "$workspace_source_path" == "$parent" ]] || die "Herdr workspace $parent_workspace_id does not point to the current parent root"
}

branch=''
path=''
message=''
approve=false
parent_workspace_id=''

while (($#)); do
  case "$1" in
    --branch)
      (($# >= 2)) || die '--branch requires a value'
      branch="$2"
      shift 2
      ;;
    --path)
      (($# >= 2)) || die '--path requires a value'
      path="$2"
      shift 2
      ;;
    --message)
      (($# >= 2)) || die '--message requires a value'
      message="$2"
      shift 2
      ;;
    --approve)
      approve=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

require_command git
require_command herdr
require_command python3
require_parent_checkout

[[ -n "$branch" || -n "$path" ]] || die 'one of --branch or --path is required'
[[ -z "$branch" || -z "$path" ]] || die '--branch and --path are mutually exclusive'
if [[ -n "$path" && "$path" != /* ]]; then
  die '--path must be absolute'
fi

worktrees_response="$parent_workspace_snapshot"
source_root="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("repo_root", ""))' <<<"$worktrees_response")"
source_workspace_id="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("source_workspace_id", ""))' <<<"$worktrees_response")"
[[ "$source_root" == "$parent" ]] || die 'Herdr source checkout does not match the current parent root'
[[ -n "$source_workspace_id" ]] || die 'Herdr did not return the parent workspace ID'

if [[ -n "$branch" ]]; then
  target_json="$(python3 -c 'import json, sys; d = json.load(sys.stdin); branch = sys.argv[1]; matches = [w for w in d.get("result", {}).get("worktrees", []) if w.get("is_linked_worktree") is True and w.get("branch") == branch]; print(json.dumps(matches[0]) if matches else "")' "$branch" <<<"$worktrees_response")"
else
  target_path="$(realpath "$path" 2>/dev/null || true)"
  [[ -n "$target_path" ]] || die "linked worktree path does not exist: $path"
  target_json="$(python3 -c 'import json, sys; d = json.load(sys.stdin); path = sys.argv[1]; matches = [w for w in d.get("result", {}).get("worktrees", []) if w.get("is_linked_worktree") is True and w.get("path") == path]; print(json.dumps(matches[0]) if matches else "")' "$target_path" <<<"$worktrees_response")"
fi
[[ -n "$target_json" && "$target_json" != null ]] || die 'no matching linked Herdr worktree was found'

target_branch="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("branch", ""))' <<<"$target_json")"
target_path="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("path", ""))' <<<"$target_json")"
target_workspace_id="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("open_workspace_id", ""))' <<<"$target_json")"
[[ -n "$target_branch" && -n "$target_path" && -n "$target_workspace_id" ]] || die 'Herdr returned incomplete linked worktree metadata'
[[ "$target_workspace_id" != "$source_workspace_id" ]] || die 'refusing to finish the parent workspace'

[[ -d "$target_path" ]] || die "linked worktree path does not exist: $target_path"
target_root="$(git -C "$target_path" rev-parse --show-toplevel 2>/dev/null)" || die 'linked path is not a Git worktree'
[[ "$target_root" == "$target_path" ]] || die 'Herdr path and Git worktree root differ'
[[ "$(git -C "$target_path" branch --show-current)" == "$target_branch" ]] || die 'linked worktree branch metadata does not match Git'

# Never merge a dirty checkout. The child reports completion independently;
# this helper does not inspect, monitor, or wait on child agent state.
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || die 'parent checkout has uncommitted changes; refusing to merge'
[[ -z "$(git -C "$target_path" status --porcelain=v1 --untracked-files=all)" ]] || die 'linked worktree has uncommitted changes; ask the child agent to commit first'

read -r parent_only branch_only <<<"$(git rev-list --left-right --count "$parent_branch...$target_branch")"
[[ "${branch_only:-0}" =~ ^[0-9]+$ && "$branch_only" -gt 0 ]] || die "branch has no commits not already in $parent_branch: $target_branch"

if [[ -z "$message" ]]; then
  message="Merge $target_branch into $parent_branch"
fi

if [[ "$approve" != true ]]; then
  python3 - "$parent" "$parent_branch" "$target_branch" "$target_path" "$target_workspace_id" "$message" <<'PY'
import json
import sys

parent, parent_branch, branch, path, workspace, message = sys.argv[1:]
print(json.dumps({
    "type": "merge_approval_required",
    "parent": parent,
    "parent_branch": parent_branch,
    "branch": branch,
    "worktree_path": path,
    "workspace_id": workspace,
    "proposed_merge_message": message,
    "action_required": "obtain explicit user approval, then rerun with --approve",
}, indent=2))
PY
  exit 2
fi

if ! merge_output="$(git -C "$parent" merge --no-ff --no-edit -m "$message" "$target_branch" 2>&1)"; then
  printf '%s\n' "$merge_output" >&2
  die 'merge failed; conflict state left intact and linked worktree was not removed'
fi

remove_response="$(herdr worktree remove --workspace "$target_workspace_id")"

python3 - "$parent" "$parent_branch" "$target_branch" "$target_path" "$target_workspace_id" "$source_workspace_id" "$message" "$merge_output" "$remove_response" <<'PY'
import json
import sys

parent, parent_branch, branch, path, workspace, parent_workspace, message, merge_output, remove_response = sys.argv[1:]
print(json.dumps({
    "type": "delegated_worktree_finished",
    "parent": parent,
    "parent_branch": parent_branch,
    "branch": branch,
    "worktree_path": path,
    "workspace_id": workspace,
    "parent_workspace_id": parent_workspace,
    "merge_message": message,
    "merge_output": merge_output,
    "worktree_removed": True,
    "herdr": json.loads(remove_response),
}, indent=2))
PY
