#!/usr/bin/env node
// The installed entry point. It runs the build, never the source: Node refuses to strip
// types for files under node_modules, which is where this file lands once installed.
// `pnpm room` runs the source through the development export condition.
import "../dist/cli.js"
