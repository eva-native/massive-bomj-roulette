#!/bin/sh
# PostToolUse (Edit|Write): after a change to a source of generated code, run
# `make gen` so the generated files never fall behind (CI checks them).
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in
  */server/internal/store/migrations/* | */server/internal/store/queries/* | */server/internal/api/*.go)
    root=${f%%/server/internal/*} ;;
  */docs/rules/*.md)
    root=${f%%/docs/rules/*} ;;
  *) exit 0 ;;
esac

# The repo root comes from the edited file, so this works in worktrees too.
if ! out=$(make -C "$root" gen 2>&1); then
  printf 'make gen failed after editing %s:\n%s\n' "$f" "$out" >&2
  exit 2
fi
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"make gen ran after this edit; generated code is up to date."}}\n'
