---
"@autotelic/jig-cli": patch
---

Run jig's OpenCode plugin under Node, not the host binary.

`src/opencode.ts` fell back to `process.execPath` to run this package's own bin. In the
OpenCode server — a bun-compiled binary — `process.execPath` is OpenCode itself, so the
fallback ran `opencode bin/jig.js …` and OpenCode printed its help instead of a report. A
session with no `jig` on `PATH` and no `JIG_BIN` therefore never got a report through the
plugin's tools.

The launcher now prefers a `jig` on `PATH`, then this checkout's build, then its source,
each under a Node found on `PATH` (falling back to whatever runs the host only when no Node
exists). `resolveLauncher` is a pure function, and `src/opencode.test.ts` pins the decision
that the byte-parity suite cannot reach because it pins `JIG_BIN`.
