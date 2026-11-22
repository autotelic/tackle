/* oxlint-disable plumb/prefer-property-tests -- the subject is three fixed clipboard outcomes: copied, selected, unavailable. */
import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { copyOrSelect, type CopyRequest } from "../src/copy.ts"

const run = (request: CopyRequest) => Effect.runPromise(copyOrSelect(request))

const attach = "hc attach t1d"

void test("a working clipboard copies the command and never selects the page", async () => {
  const written: string[] = []
  const outcome = await run({
    text: attach,
    writeText: (text) => {
      written.push(text)
      return Promise.resolve()
    },
    select: () => {
      throw new Error("the fallback must not run when the clipboard worked")
    },
  })
  assert.equal(outcome, "copied")
  assert.deepEqual(written, [attach])
})

void test("no clipboard API selects the visible command instead of failing", async () => {
  let selections = 0
  const outcome = await run({
    text: attach,
    select: () => {
      selections += 1
      return true
    },
  })
  assert.equal(outcome, "selected")
  assert.equal(selections, 1)
})

void test("a rejected clipboard write (iOS Safari outside a gesture) selects the command", async () => {
  let selections = 0
  const outcome = await run({
    text: attach,
    writeText: () => Promise.reject(new Error("NotAllowedError")),
    select: () => {
      selections += 1
      return true
    },
  })
  assert.equal(outcome, "selected")
  assert.equal(selections, 1)
})

void test("a clipboard with nothing to select is the one reported failure", async () => {
  const outcome = await run({
    text: attach,
    writeText: () => Promise.reject(new Error("NotAllowedError")),
    select: () => false,
  })
  assert.equal(outcome, "unavailable")
})
