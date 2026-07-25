#!/bin/sh
# PreToolUse guard (Bash matcher): stop branch and worktree creation at the tool
# layer, before git ever runs. Reads the hook JSON on stdin; exit 2 blocks the call.
in=$(cat)
deny() {
  echo "$1 Everything develops and pushes on main (CLAUDE.md branch discipline)." >&2
  exit 2
}
printf '%s' "$in" | grep -qE 'worktree[[:space:]]+add' && deny "Blocked: git worktree add is banned."
printf '%s' "$in" | grep -qE 'checkout[[:space:]]+-[bB][[:space:]]' && deny "Blocked: branch creation (checkout -b) is banned."
printf '%s' "$in" | grep -qE 'switch[[:space:]]+(-[cC]|--create)[[:space:]]' && deny "Blocked: branch creation (switch -c) is banned."
if printf '%s' "$in" | grep -qE 'git[^"]*push' && printf '%s' "$in" | grep -qE '(^|[^.[:alnum:]_])(claude|feature)/'; then
  printf '%s' "$in" | grep -qE -- '--delete|[[:space:]]:(refs/heads/)?(claude|feature)/' \
    || deny "Blocked: pushing claude/* or feature/* branches is banned (deleting them is allowed)."
fi
exit 0
