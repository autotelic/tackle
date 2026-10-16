#!/usr/bin/env node
// The installed entry point. It runs the build, never the source: Node refuses to
// strip types for files under node_modules, which is where this file lands once the
// package is installed. `pnpm jig` runs the source via the development condition.
import "../dist/cli.js"
