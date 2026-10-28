#!/bin/sh
# PreToolUse (Edit|Write): generated code is never edited by hand.
# Exit 2 refuses the edit and shows the message to Claude.
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in
  */server/internal/store/db/* | */web/src/api/types.gen.ts | */server/internal/game/items/texts_gen.go)
    echo "$f is generated. Change its source instead (SQL in server/internal/store, server/internal/api or docs/rules); make gen rewrites it." >&2
    exit 2
    ;;
esac
exit 0
