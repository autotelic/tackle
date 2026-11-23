#!/bin/sh
# The Pi worker a factory workstream runs. Low thinking is the default because the pass is
# bounded by the prompt and the receipt; raise it only for a workstream that needs it.
set -eu
stamp=$(date -u +%Y%m%dT%H%M%SZ)
session="factory-${FACTORY_WORKSTREAM:-unknown}-$stamp"
exec pi --print \
  --session-dir "$HOME/.factory/sessions" \
  --session-id "$session" \
  --name "$session" \
  --model opencode-go/deepseek-v4.1-flash \
  --thinking "${FACTORY_THINKING:-low}" \
  "$FACTORY_PROMPT"
