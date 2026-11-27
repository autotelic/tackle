#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here"

rm -rf source worktrees
mkdir -p source
cp -R app/. source/

cd source
git init -q -b main
git config user.email orb@example.test
git config user.name "Orb Setup"
git add .
git commit -qm "orb source"
source_head=$(git rev-parse HEAD)

mkdir -p ../worktrees
for name in factory-a factory-b; do
  git worktree add -q "../worktrees/$name" -b "orb/$name"
  branch=$(git -C "../worktrees/$name" branch --show-current)
  head=$(git -C "../worktrees/$name" rev-parse HEAD)
  printf '{\n  "branch": "%s",\n  "head": "%s",\n  "sourceHead": "%s",\n  "worktree": "%s"\n}\n' "$branch" "$head" "$source_head" "$here/worktrees/$name" > "../worktrees/$name/src/worktree.json"
done

printf 'source %s\n' "$source_head"
printf 'worktree %s\n' "$here/worktrees/factory-a"
printf 'worktree %s\n' "$here/worktrees/factory-b"
