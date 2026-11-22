/* oxlint-disable plumb/prefer-property-tests -- the subject is one committed stylesheet, not a generated input. */
import { readFileSync } from "node:fs"
import { expect, test } from "vitest"

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8")

/** The body of the first rule or at-rule whose header starts with `marker`. */
const blockAt = (source: string, marker: string): string => {
  const start = source.indexOf(marker)
  if (start === -1) return ""
  const open = source.indexOf("{", start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1
    else if (source[index] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  return source.slice(open)
}

/*
 * There is no browser in this repository's checks, so the phone contract is
 * asserted where it lives: the stylesheet that ships. These rules are the ones
 * the issue turns on, and each would fail if the rule were dropped.
 */
test("hover is an enhancement: every :hover rule is inside @media (hover: hover)", () => {
  const pointer = blockAt(css, "@media (hover: hover)")
  expect(pointer).toContain(":hover")
  expect(css.replace(pointer, "")).not.toContain(":hover")
})

test("a button is at least a 44px thumb target", () => {
  const base = blockAt(css, "button {")
  expect(base).toMatch(/min-height:\s*44px/)
  expect(base).toMatch(/min-width:\s*44px/)
})

test("the command is selectable text, which is the iOS copy fallback", () => {
  const command = blockAt(css, ".session-command")
  expect(command).toMatch(/user-select:\s*all/)
  expect(command).toMatch(/-webkit-user-select:\s*all/)
})

test("390px is one column", () => {
  expect(css).toContain("@media (max-width: 430px)")
  const narrow = blockAt(css, "@media (max-width: 430px)")
  expect(narrow.length).toBeGreaterThan(0)
  expect(blockAt(narrow, ".state-machine .states")).toMatch(/grid-template-columns:\s*1fr/)
  expect(blockAt(narrow, ".shell")).toMatch(/padding:\s*12px/)
})

test("at 390px the workstream metadata is a column, not a wide flex row", () => {
  // 760px is where the summary's repo/branch/PR/checkpoint row stops fitting.
  // Below it the fields stack, so a long repo or branch name cannot push the
  // page sideways.
  const tablet = blockAt(css, "@media (max-width: 760px)")
  expect(blockAt(tablet, ".workstream-meta")).toMatch(/grid-template-columns:\s*1fr/)
})

test("every horizontal row wraps or stacks, so nothing scrolls sideways", () => {
  // A flex row that neither wraps nor shrinks to a column overflows the
  // viewport as soon as one identifier is longer than the phone is wide.
  for (const selector of [
    ".header",
    ".activity-head",
    ".activity-meta",
    ".session-main",
    ".report-head",
  ]) {
    expect(blockAt(css, selector), selector).toMatch(/flex-wrap:\s*wrap/)
  }
  expect(blockAt(css, ".session")).toMatch(/flex-direction:\s*column/)
})

test("nothing overflows its column silently", () => {
  for (const selector of [
    ".repo-name",
    ".workstream-name",
    ".workstream-meta > *",
    ".session-command",
    ".report-body",
  ]) {
    expect(blockAt(css, selector), selector).toMatch(/overflow-wrap:\s*anywhere/)
  }
})
