#!/bin/sh
# SessionStart self-heal: activate the committed hooks and the author identity in
# any fresh clone (remote sessions clone fresh every time, so repo git config is
# empty until this runs). Idempotent, silent, never fails the session.
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
[ -d .githooks ] && git config core.hooksPath .githooks
git config user.name "Advik Bhatt"
git config user.email "advik.bhatt@gmail.com"
exit 0
