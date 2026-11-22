/* oxlint-disable plumb/prefer-property-tests -- the subject is one committed stylesheet, not a generated input. */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

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
void test("hover is an enhancement: every :hover rule is inside @media (hover: hover)", () => {
  const pointer = blockAt(css, "@media (hover: hover)")
  assert.ok(pointer.includes(":hover"), "the pointer block is where hover lives")
  assert.equal(css.replace(pointer, "").includes(":hover"), false)
})

void test("a button is at least a 44px thumb target", () => {
  const base = blockAt(css, "button {")
  assert.match(base, /min-height:\s*44px/)
  assert.match(base, /min-width:\s*44px/)
})

void test("the command is selectable text, which is the iOS copy fallback", () => {
  const command = blockAt(css, ".session-command")
  assert.match(command, /user-select:\s*all/)
  assert.match(command, /-webkit-user-select:\s*all/)
})

void test("390px is one column", () => {
  const narrow = blockAt(css, "@media (max-width: 430px)")
  assert.ok(narrow.length > 0)
  assert.match(blockAt(narrow, ".state-machine .states"), /grid-template-columns:\s*1fr/)
  assert.match(blockAt(narrow, ".shell"), /padding:\s*12px/)
})

void test("nothing overflows its column silently", () => {
  for (const selector of [".repo-name", ".workstream-name", ".session-command", ".report-body"]) {
    assert.match(blockAt(css, selector), /overflow-wrap:\s*anywhere/, selector)
  }
})
