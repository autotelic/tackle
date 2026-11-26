#!/bin/sh
# The Pi worker a factory workstream runs. Low thinking is the default because the pass is
# bounded by the prompt and the receipt; raise it only for a workstream that needs it.
#
# `-ne` is not a speed flag. A room's worktree is nested inside the repository it
# checks out (\`.room/<id>/worktree\`), so Pi discovers the project-local jig
# extension from BOTH roots: the outer checkout installs \`@autotelic/jig-cli\` from
# \`.pi/settings.json\` and the worktree is a second copy of the same package. The six
# \`jig_*\` tool names then collide, Pi aborts with exit 1 before the agent starts, and
# the daemon records a failed pass and retries -- twenty-two passes in under a minute on
# the first workstream that tried it, none of which reached the model.
#
# A worker pass is a shell pass: it reads the event, edits the tree, runs the gate's
# commands and commits. The interactive tool surface is for sessions a human is in, and
# inheriting it here buys nothing while making the pass depend on two checkouts of the
# same extension agreeing about names. Starting without extensions is what makes the pass
# hermetic. The nesting itself is the real defect; see the report on tackle-joggle-restated-value.
set -eu
stamp=$(date -u +%Y%m%dT%H%M%SZ)
session="factory-${FACTORY_WORKSTREAM:-unknown}-$stamp"
exec pi -ne --print \
  --session-dir "$HOME/.factory/sessions" \
  --session-id "$session" \
  --name "$session" \
  --model opencode-go/deepseek-v4.1-flash \
  --thinking "${FACTORY_THINKING:-low}" \
  "$FACTORY_PROMPT"
