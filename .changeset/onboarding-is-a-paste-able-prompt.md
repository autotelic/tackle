---
"@autotelic/jig-cli": minor
---

`jig init` writes `ONBOARD.md` as one paste-able prompt that sets the whole harness up, and
it now knows how the CLI gets onto a machine.

The old file was a reference page an agent had to interpret. The new one is the shape that
works in the tools people actually paste from: "put `jig` on this machine" first, with the
package manager's own verb (`pnpm add -g`, `npm install -g`, `yarn global add`) and the
source that is honest for this repository — `./packages/jig-cli` when the tree builds jig,
`@autotelic/jig-cli` when it does not — then the PATH fix when the global bin directory is
missing (`pnpm setup`), before anything is installed or run.

From there it walks: read the config it just wrote, install the engines the census says are
missing (devDependencies, never global), run `init`, read the census before the findings,
wire the agent host (`pi install … --local`, or `"plugin": ["@autotelic/jig-cli/opencode"]`
in `opencode.json`), and — in a repository that keeps a room — show `jig room plan` and stop.
A host that is already wired is updated rather than added twice, the baseline and a gate
change stay in the never-without-asking list, and every step that installs something says
**STOP and ask**.
