#!/usr/bin/env sh
# The `joggle` command, usable from any workspace.
#
# Symlink it onto PATH once:
#
#   ln -sf <repo>/scripts/joggle.sh ~/.local/bin/joggle
#
# It runs this checkout's build, and supplies the TypeSafe key when the
# environment does not already have one and the run needs the model. Sources,
# in order: the environment, a gitignored `.env.local`, a gitignored `.env`
# (both beside this script), then doppler (fetched from the joggle root, with
# HOME restored).
set -eu

# Resolve the symlink chain to the real script, then its repository.
src=$0
while [ -L "$src" ]; do
  dir=$(CDPATH= cd -- "$(dirname -- "$src")" && pwd)
  src=$(readlink "$src")
  case "$src" in
    /*) ;;
    *) src="$dir/$src" ;;
  esac
done
root=$(CDPATH= cd -- "$(dirname -- "$src")/.." && pwd)

# A host such as pi can spawn this with no HOME. Restore it from the passwd
# database: doppler needs it to find its auth, and joggle uses it for the
# machine cache -- without it the cache would land in the analysed directory.
if [ -z "${HOME:-}" ]; then
  user=$(id -un 2>/dev/null) || user=""
  case "$(uname -s)" in
    Darwin) HOME=$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | awk '{print $2}') ;;
    *) HOME=$(getent passwd "$user" 2>/dev/null | cut -d: -f6) ;;
  esac
  export HOME
fi

if [ -f "$root/dist/main.js" ]; then
  entry="$root/dist/main.js"
  conditions=""
else
  entry="$root/src/main.ts"
  conditions="--conditions=development"
fi

# The value of KEY in a dotenv-style file, without executing the file.
env_value() {
  [ -f "$1" ] || return 0
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=" "$1" 2>/dev/null | head -n 1) || true
  [ -n "$line" ] || return 0
  printf '%s' "${line#*=}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# The judged layer is the only thing that needs the key. Everything else runs
# directly, so `rules`, help and `--offline` never pay doppler's startup.
needs_key=true
case "${1:-}" in
  rules | --help | -h | --version | -v | --completions | --wizard) needs_key=false ;;
esac
case " $* " in
  *" --offline "*) needs_key=false ;;
esac

key=${TYPESAFE_API_KEY:-}
if [ "$needs_key" = true ] && [ -z "$key" ]; then
  key=$(env_value "$root/.env.local" TYPESAFE_API_KEY) || key=""
fi
if [ "$needs_key" = true ] && [ -z "$key" ]; then
  key=$(env_value "$root/.env" TYPESAFE_API_KEY) || key=""
fi

if [ "$needs_key" = true ] && [ -z "$key" ] && command -v doppler >/dev/null 2>&1; then
  project=${JOGGLE_DOPPLER_PROJECT:-joggle}
  config=${JOGGLE_DOPPLER_CONFIG:-dev}
  # doppler resolves the project from the WORKING DIRECTORY's doppler.yaml, and a
  # sibling repository's setup wins over the explicit --project/--config (and
  # over DOPPLER_PROJECT/DOPPLER_CONFIG). So fetch the one secret from the joggle
  # root, then run from the caller's directory: the analysed root, a relative
  # --cwd, and the report's paths all stay what the caller asked for. HOME was
  # restored above, which doppler needs to find its own auth.
  key=$(cd "$root" && doppler secrets get TYPESAFE_API_KEY --project "$project" --config "$config" --plain 2>/dev/null) || key=""
fi

if [ "$needs_key" = true ] && [ -n "$key" ]; then
  export TYPESAFE_API_KEY="$key"
  # shellcheck disable=SC2086
  exec node $conditions "$entry" "$@"
fi

# A key that could not be found must not take the tool down with it: the run
# degrades to unverified findings, which is what a missing key already means.
# On stderr, so a host can surface it; on stdout it would corrupt `--format
# json`, which is what the pi tools read.
if [ "$needs_key" = true ]; then
  echo "joggle: no model key from the environment, $root/.env.local, or doppler; running without the model" >&2
fi

# shellcheck disable=SC2086
exec node $conditions "$entry" "$@"
