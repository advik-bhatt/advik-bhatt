#!/bin/sh
# SessionStart self-heal: activate the committed hooks and the author identity in
# any fresh clone (remote sessions clone fresh every time, so repo git config is
# empty until this runs). Idempotent, silent, never fails the session.
#
# The repo root is derived from this script's own location (.claude/hooks/ is two
# levels below root), NOT from the caller's cwd — an installer or hook may invoke
# this from anywhere.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." 2>/dev/null && pwd)
if [ -z "$root" ] || [ ! -e "$root/.git" ]; then
  root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
fi
cd "$root" || exit 0
[ -d .githooks ] && git config core.hooksPath .githooks
git config user.name "Advik Bhatt"
git config user.email "advik.bhatt@gmail.com"
exit 0
