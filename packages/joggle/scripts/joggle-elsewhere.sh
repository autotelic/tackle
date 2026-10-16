#!/usr/bin/env sh
# Run joggle against another checkout without writing into it.
#
#   scripts/joggle-elsewhere.sh ../shakti-v2 --since origin/develop --offline
#
# The checkout is analysed, never modified: no config, no cache, no install.
# The answer cache goes to the machine cache unless the target already has a
# committed .joggle/ directory, which is the same rule the pi extension uses.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$#" -lt 1 ]; then
  echo "usage: $(basename -- "$0") <path> [joggle check args...]" >&2
  exit 2
fi

target=$(CDPATH= cd -- "$1" && pwd)
shift

if [ -f "$root/dist/main.js" ]; then
  entry="$root/dist/main.js"
  conditions=""
else
  entry="$root/src/main.ts"
  conditions="--conditions=development"
fi

cache_args=""
case " $* " in
  *" --cache-dir "*)
    # The caller chose a cache; do not add a second one.
    ;;
  *)
    if [ ! -d "$target/.joggle" ]; then
      case "$(uname -s)" in
        Darwin) base="${XDG_CACHE_HOME:-$HOME/Library/Caches}" ;;
        *) base="${XDG_CACHE_HOME:-$HOME/.cache}" ;;
      esac
      key=$(node -e 'const c = require("node:crypto"); process.stdout.write(c.createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 16))' "$target")
      cache_args="--cache-dir $base/joggle/$key"
    fi
    ;;
esac

# shellcheck disable=SC2086
exec node $conditions "$entry" check --cwd "$target" $cache_args "$@"
