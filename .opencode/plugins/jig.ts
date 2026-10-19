/*
 * Dogfood jig's own OpenCode plugin.
 *
 * OpenCode auto-discovers plugins under `.opencode/plugins/`, and a `.ts` file here is
 * loaded directly. This re-export is deliberately a pointer, not a second plugin: the
 * one implementation stays in `packages/jig-cli/src/opencode.ts` so a session in this
 * repo exercises the real surface, and edits to it take effect without a build.
 */
export { default } from "../../packages/jig-cli/src/opencode.ts"
