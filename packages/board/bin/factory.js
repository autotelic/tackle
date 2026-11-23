#!/usr/bin/env node
// The compatibility entry point for existing factory callers. The canonical command is
// `board`; this forwards into the built command surface and exits with its code.
import { factoryMain } from "../dist/factory/cli.js"

factoryMain().catch((cause) => {
  console.error("factory: " + String(cause))
  process.exitCode = 1
})
