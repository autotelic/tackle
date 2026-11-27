# Factory orbs

Two factories, one source codebase, two worktrees, two containers, two independent services.

```text
source repo (one commit)
  ├─ worktrees/factory-a  branch orb/factory-a
  └─ worktrees/factory-b  branch orb/factory-b

container A   /app = worktree A   web :4400   -> host :4901
container B   /app = worktree B   web :4400   -> host :4902
```

Both containers run the same image and listen on the same internal port. They never share a
worktree, a build output, or a storage origin. The supervisor talks to them only through the
host ports.

## Run

```sh
./setup.sh
docker compose up --build -d
open http://127.0.0.1:4901/
open http://127.0.0.1:4902/
```

## Interact as a supervisor

```sh
node supervise.mjs status
node supervise.mjs note a "try the refusal path first"
node supervise.mjs note b "keep the current shape"
```

Each note rewrites only that worktree's `src/state.json`, rebuilds only that `public/index.html`,
and serves it on that factory's external port. The other factory's branch, state and build output
are unchanged.

## Prove the boundary

```sh
curl -s http://127.0.0.1:4901/api/state
curl -s http://127.0.0.1:4902/api/state
```

The two responses name different branches and worktrees but the same `sourceHead`. Both report
`internalPort: 4400`; their external ports differ.

Stop with `docker compose down`.
