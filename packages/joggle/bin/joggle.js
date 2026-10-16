#!/usr/bin/env node
// The installed entry point. It runs the build, not the source, because Node
// refuses to strip types for files under node_modules -- which is exactly where
// this file lives once the package is installed. `pnpm build` produces dist/;
// `pnpm joggle` runs the source directly with the development export condition.
import "../dist/main.js"
