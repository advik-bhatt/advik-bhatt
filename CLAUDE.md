# advik-bhatt (profile) — agent rules

Global rules live in `advik-bhatt/knowledge-base` → CLAUDE.md (branch
discipline: all work commits directly to main, no worktrees, no feature
branches; commit author Advik Bhatt <advik.bhatt@gmail.com>; no model IDs
in commit messages).

Before any commit, verify `git config user.name` is `Advik Bhatt` and
`git config user.email` is `advik.bhatt@gmail.com`. Remote sessions ship
a global git config authored as Claude; override it locally in this repo
first. Never commit as Claude, and never create or push to a `claude/…`
or any other side branch — all work lands directly on `main`.
