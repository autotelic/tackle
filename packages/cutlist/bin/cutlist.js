#!/usr/bin/env node
// The installed entry point. It runs the build, not the source, because Node refuses
// to strip types for files under node_modules — which is exactly where this file lands
// once the package is installed. `pnpm build` produces dist/; `pnpm cutlist` runs the
// source directly through the development export condition.
import "../dist/cli.js"
