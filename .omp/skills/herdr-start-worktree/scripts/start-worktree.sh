#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: start-worktree.sh --branch BRANCH [options]

Create a linked Herdr worktree from the current parent checkout. The command
must be run from the parent repository root, not from a linked worktree.

Options:
  --branch BRANCH          New local branch and worktree branch (required)
  --base REF               Commit/ref to branch from (default: current branch)
  --label TEXT             Herdr workspace label (default: branch)
  --path PATH              Explicit absolute worktree checkout path
  --worktree-name NAME     Name used to derive the delegated agent name
  --start-agent            Start a codex agent only if the plugin created none
  --agent-kind KIND        Agent kind for --start-agent (default: codex)
  --help                   Show this help
EOF
}

die() {
  printf 'start-worktree: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_parent_checkout() {
  [[ "${HERDR_ENV:-}" == 1 ]] || die 'HERDR_ENV=1 is required; run this from a Herdr-managed pane'
  parent_workspace_id="${HERDR_WORKSPACE_ID:-}"
  [[ -n "$parent_workspace_id" ]] || die 'HERDR_WORKSPACE_ID is required; target the parent Herdr workspace explicitly'

  local parent git_root git_dir workspace_source_root workspace_source_path workspace_source_id
  parent="$(pwd -P)"
  git_root="$(git rev-parse --show-toplevel 2>/dev/null)" || die 'current directory is not a Git checkout'
  [[ "$git_root" == "$parent" ]] || die "run from the parent repository root: $git_root"
  [[ "$(git rev-parse --is-inside-work-tree)" == true ]] || die 'parent checkout is not a worktree'
  git_dir="$(git rev-parse --absolute-git-dir)"
  [[ "$git_dir" == "$parent/.git" ]] || die 'the current checkout is already a linked worktree'
  [[ -n "$(git branch --show-current)" ]] || die 'parent checkout is detached; check out the parent branch first'

  parent_workspace_snapshot="$(herdr worktree list --workspace "$parent_workspace_id")"
  workspace_source_root="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("repo_root", ""))' <<<"$parent_workspace_snapshot")"
  workspace_source_path="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("source_checkout_path", ""))' <<<"$parent_workspace_snapshot")"
  workspace_source_id="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("result", {}).get("source", {}).get("source_workspace_id", ""))' <<<"$parent_workspace_snapshot")"
  [[ "$workspace_source_id" == "$parent_workspace_id" ]] || die "Herdr workspace $parent_workspace_id is not the parent workspace"
  [[ "$workspace_source_root" == "$parent" && "$workspace_source_path" == "$parent" ]] || die "Herdr workspace $parent_workspace_id does not point to the current parent root"
}

branch=''
base=''
label=''
path=''
worktree_name=''
start_agent=false
agent_kind='codex'
parent_workspace_id=''

while (($#)); do
  case "$1" in
    --branch)
      (($# >= 2)) || die '--branch requires a value'
      branch="$2"
      shift 2
      ;;
    --base)
      (($# >= 2)) || die '--base requires a value'
      base="$2"
      shift 2
      ;;
    --label)
      (($# >= 2)) || die '--label requires a value'
      label="$2"
      shift 2
      ;;
    --path)
      (($# >= 2)) || die '--path requires a value'
      path="$2"
      shift 2
      ;;
    --worktree-name)
      (($# >= 2)) || die '--worktree-name requires a value'
      worktree_name="$2"
      shift 2
      ;;
    --start-agent)
      start_agent=true
      shift
      ;;
    --agent-kind)
      (($# >= 2)) || die '--agent-kind requires a value'
      agent_kind="$2"
      shift 2
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

[[ -n "$branch" ]] || die '--branch is required'
[[ "$branch" != -* ]] || die 'branch names beginning with - are not supported'
git check-ref-format --branch "$branch" >/dev/null 2>&1 || die "invalid branch name: $branch"

git show-ref --verify --quiet "refs/heads/$branch" && die "local branch already exists: $branch" || true

if [[ -z "$base" ]]; then
  base="$(git branch --show-current)"
fi
git rev-parse --verify --quiet "$base^{commit}" >/dev/null || die "base ref does not resolve to a commit: $base"

if [[ -z "$label" ]]; then
  label="$branch"
fi
if [[ -n "$path" && "$path" != /* ]]; then
  die '--path must be absolute'
fi

if [[ -z "$worktree_name" ]]; then
  worktree_name="${branch##*/}"
fi
agent_slug="$(printf '%s' "$worktree_name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//')"
[[ -n "$agent_slug" ]] || die 'worktree name produces an empty agent name'
agent_slug="${agent_slug:0:27}"
agent_name="omp-${agent_slug}"
[[ "$agent_name" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || die "derived agent name is invalid: $agent_name"

agents_before="$(herdr agent list)"
if python3 -c 'import json, sys; agents = json.load(sys.stdin).get("result", {}).get("agents", []); sys.exit(0 if any(a.get("name") == sys.argv[1] for a in agents) else 1)' "$agent_name" <<<"$agents_before"; then
  die "agent name is already in use: $agent_name"
fi

create_args=(worktree create --workspace "$parent_workspace_id" --branch "$branch" --base "$base" --label "$label" --no-focus)
if [[ -n "$path" ]]; then
  create_args+=(--path "$path")
fi
create_response="$(herdr "${create_args[@]}")"
workspace_id="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["result"]["workspace"]["workspace_id"])' <<<"$create_response")"
root_pane_id="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["result"]["root_pane"]["pane_id"])' <<<"$create_response")"
[[ -n "$workspace_id" ]] || die 'Herdr did not return a workspace ID'
[[ -n "$root_pane_id" ]] || die 'Herdr did not return a root pane ID'

# The workspace-manager plugin may start its configured agent asynchronously.
# This bounded startup check is only for setup; it never waits for delegated
# work to finish.
agent_records='[]'
for _ in 1 2 3 4 5; do
  agents_now="$(herdr agent list)"
  agent_records="$(python3 -c 'import json, sys; d = json.load(sys.stdin); ws = sys.argv[1]; print(json.dumps([a for a in d.get("result", {}).get("agents", []) if a.get("workspace_id") == ws], separators=(",", ":")))' "$workspace_id" <<<"$agents_now")"
  if [[ "$(python3 -c 'import json, sys; print(len(json.load(sys.stdin)))' <<<"$agent_records")" -gt 0 ]]; then
    break
  fi
  sleep 1
done

agent_count="$(python3 -c 'import json, sys; print(len(json.load(sys.stdin)))' <<<"$agent_records")"
if [[ "$agent_count" == 1 ]]; then
  read -r existing_agent_name existing_agent_target <<<"$(python3 -c 'import json, sys; a = json.load(sys.stdin)[0]; print(a.get("name", ""), a["pane_id"])' <<<"$agent_records")"
  if [[ "$existing_agent_name" != "$agent_name" ]]; then
    renamed=false
    for _ in 1 2 3 4 5; do
      if herdr agent rename "${existing_agent_name:-$existing_agent_target}" "$agent_name" >/dev/null 2>/dev/null; then
        renamed=true
        break
      fi
      sleep 1
    done
    if [[ "$renamed" != true ]]; then
      if ! cleanup_output="$(herdr worktree remove --workspace "$workspace_id" 2>&1)"; then
        printf '%s\n' "$cleanup_output" >&2
        die "could not rename the plugin agent to $agent_name and could not clean up workspace $workspace_id"
      fi
      die "could not rename the plugin agent to $agent_name; created worktree was removed"
    fi
    agents_now="$(herdr agent list)"
    agent_records="$(python3 -c 'import json, sys; d = json.load(sys.stdin); ws = sys.argv[1]; print(json.dumps([a for a in d.get("result", {}).get("agents", []) if a.get("workspace_id") == ws], separators=(",", ":")))' "$workspace_id" <<<"$agents_now")"
  fi
elif [[ "$start_agent" == true && "$agent_count" == 0 ]]; then
  if ! start_output="$(herdr agent start "$agent_name" --kind "$agent_kind" --pane "$root_pane_id" --timeout 30000 2>&1)"; then
    printf '%s\n' "$start_output" >&2
    if ! cleanup_output="$(herdr worktree remove --workspace "$workspace_id" 2>&1)"; then
      printf '%s\n' "$cleanup_output" >&2
      die "could not start agent $agent_name and could not clean up workspace $workspace_id"
    fi
    die "could not start agent $agent_name; created worktree was removed"
  fi
  agents_now="$(herdr agent list)"
  agent_records="$(python3 -c 'import json, sys; d = json.load(sys.stdin); ws = sys.argv[1]; print(json.dumps([a for a in d.get("result", {}).get("agents", []) if a.get("workspace_id") == ws], separators=(",", ":")))' "$workspace_id" <<<"$agents_now")"
fi

python3 - "$create_response" "$agent_records" "$branch" "$base" "$label" "$worktree_name" "$agent_name" "$workspace_id" "$root_pane_id" <<'PY'
import json
import os
import sys

create_response, agent_records, branch, base, label, worktree_name, agent_name, workspace_id, root_pane_id = sys.argv[1:]
print(json.dumps({
    "type": "delegated_worktree_created",
    "parent_workspace": os.environ.get("HERDR_WORKSPACE_ID"),
    "branch": branch,
    "base": base,
    "label": label,
    "worktree_name": worktree_name,
    "agent_name": agent_name,
    "workspace_id": workspace_id,
    "root_pane_id": root_pane_id,
    "agents": json.loads(agent_records),
    "layout": "herdr-plugin-workspace-manager",
    "herdr": json.loads(create_response),
}, indent=2))
PY
