#!/bin/sh
# The room's Pi surface in a real terminal, in a scratch room home.
#
# Why a terminal: the surface is a rendered thing -- a badge, a picker, a filter line -- and only a
# terminal shows what it looks like. RPC mode cannot stand in for it: `ctx.ui.custom()` returns
# undefined there, so the picker never crosses the wire. tmux is the cheapest honest terminal.
#
# Nothing here touches your real rooms: ROOM_HOME is a fixture with three rooms in it, and the
# fixture repository's room.config.json points at one of them.
#
#   scripts/tui-repl.sh up                 boot pi in the fixture and print the screen
#   scripts/tui-repl.sh shot [lines]       the screen as text, last 30 lines by default
#   scripts/tui-repl.sh keys <text>        type <text> literally
#   scripts/tui-repl.sh press <key>        enter, up, down, esc, or bspace
#   scripts/tui-repl.sh slash <command>    type a slash command and press enter
#   scripts/tui-repl.sh note <kind> <json> [room]  write a fact into a fixture room
#   scripts/tui-repl.sh stop               close the session
#
# Example -- the picker, end to end:
#
#   scripts/tui-repl.sh up
#   scripts/tui-repl.sh slash room
#   scripts/tui-repl.sh keys carbon      # filters to soil-carbon
#   scripts/tui-repl.sh press enter      # selects it; the badge changes
#   scripts/tui-repl.sh stop

set -eu

SESSION=${ROOM_TUI_SESSION:-room-tui-repl}
ROOT=${ROOM_TUI_ROOT:-/tmp/room-tui-repl}
PI=${PI_BIN:-pi}
HERE=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE_BIN:-node}

shot() {
  tmux capture-pane -pt "$SESSION" | sed -e 's/[[:space:]]*$//' | grep -v '^$' | tail -"${1:-30}"
}

room_json() {
  name=$1
  id=$2
  stage=$3
  cat > "$ROOT/home/rooms/$name.json" <<JSON
{
  "version": 1,
  "room": "linear:$id@$stage",
  "name": "$name",
  "stage": "$stage",
  "project": { "kind": "linear", "id": "$id", "name": "$name" },
  "repo": { "owner": "example", "name": "$name", "root": "/tmp" },
  "ingress": { "github": "forward", "linear": "poll" },
  "review": { "trigger": "review_requested", "provider": "openrouter", "model": "fixture", "slots": 1 },
  "createdAt": "2026-01-01T00:00:00.000Z"
}
JSON
}

up() {
  rm -rf "$ROOT"
  mkdir -p "$ROOT/repo" "$ROOT/home/rooms"

  # One executable: the extension takes ROOM_BIN as a whole command and appends its arguments.
  cat > "$ROOT/room" <<SHIM
#!/bin/sh
exec $NODE --conditions=development $HERE/src/cli.ts "\$@"
SHIM
  chmod +x "$ROOT/room"

  room_json data-migration-v1 11111111-1111-4111-8111-111111111111 local/togmund
  room_json tackle-rooms 22222222-2222-4222-8222-222222222222 local/togmund
  room_json soil-carbon 33333333-3333-4333-8333-333333333333 local/eadmundo

  # This repository's room: the one the badge and the picker mark "this repo".
  cp "$ROOT/home/rooms/data-migration-v1.json" "$ROOT/repo/room.config.json"

  now=$($NODE -e 'console.log(Date.now())')
  cat > "$ROOT/home/index.json" <<JSON
{
  "version": 1,
  "rooms": [
    { "room": "linear:11111111-1111-4111-8111-111111111111@local/togmund", "name": "data-migration-v1",
      "projectId": "11111111-1111-4111-8111-111111111111", "stage": "local/togmund",
      "configPath": "$ROOT/home/rooms/data-migration-v1.json", "lastSeen": $now },
    { "room": "linear:22222222-2222-4222-8222-222222222222@local/togmund", "name": "tackle-rooms",
      "projectId": "22222222-2222-4222-8222-222222222222", "stage": "local/togmund",
      "configPath": "$ROOT/home/rooms/tackle-rooms.json", "lastSeen": $((now - 3600000)) },
    { "room": "linear:33333333-3333-4333-8333-333333333333@local/eadmundo", "name": "soil-carbon",
      "projectId": "33333333-3333-4333-8333-333333333333", "stage": "local/eadmundo",
      "configPath": "$ROOT/home/rooms/soil-carbon.json", "lastSeen": 0 }
  ]
}
JSON

  tmux kill-session -t "$SESSION" 2>/dev/null || true
  sleep 1
  tmux new-session -d -s "$SESSION" -x 110 -y 30 \
    "cd $ROOT/repo && ROOM_HOME=$ROOT/home ROOM_BIN=$ROOT/room $PI --offline --no-session -ne -e $HERE/extensions/pi.ts"

  # Wait for the badge: it is the proof the extension attached to the fixture room.
  i=0
  while [ "$i" -lt 40 ]; do
    sleep 1
    if tmux capture-pane -pt "$SESSION" | grep -q 'room data-migration-v1'; then break; fi
    i=$((i + 1))
  done
  shot 12
}

case ${1:-up} in
  up) up ;;
  shot) shot "${2:-30}" ;;
  keys) tmux send-keys -t "$SESSION" -l "$2" ;;
  press)
    case ${2:-} in
      enter) tmux send-keys -t "$SESSION" Enter ;;
      up) tmux send-keys -t "$SESSION" Up ;;
      down) tmux send-keys -t "$SESSION" Down ;;
      esc) tmux send-keys -t "$SESSION" Escape ;;
      bspace) tmux send-keys -t "$SESSION" BSpace ;;
      *) echo "press: enter, up, down, esc, or bspace" >&2; exit 2 ;;
    esac
    ;;
  slash)
    tmux send-keys -t "$SESSION" -l "/$2"
    sleep 0.4
    tmux send-keys -t "$SESSION" Enter
    ;;
  note)
    if [ -z "${4:-}" ]; then
      "$ROOT/room" session --cwd "$ROOT/repo" --note "$2" --data "${3:-{\}}" | head -1
    else
      "$ROOT/room" session --cwd "$ROOT/repo" --room "$4" --note "$2" --data "${3:-{\}}" | head -1
    fi
    ;;
  stop) tmux kill-session -t "$SESSION" 2>/dev/null || true ;;
  *)
    echo "usage: $0 [up|shot|keys|press|slash|note|stop]" >&2
    exit 2
    ;;
esac
