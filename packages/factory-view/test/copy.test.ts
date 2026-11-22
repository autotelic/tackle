/* oxlint-disable plumb/prefer-property-tests -- the subject is three fixed clipboard outcomes: copied, selected, unavailable. */
import { Effect } from "effect"
import { expect, test } from "vitest"
import { copyOrSelect, type CopyRequest } from "../src/copy.ts"

const run = (request: CopyRequest) => Effect.runPromise(copyOrSelect(request))

const attach = "hc attach t1d"

test("a missing navigator.clipboard selects the command, never throws", async () => {
  // Outside a secure context (plain http on the tailnet, before tailscale serve)
  // the property is simply absent. The guard must absorb that, not the caller.
  for (const clipboard of [undefined, null]) {
    let selections = 0
    const outcome = await run({
      text: attach,
      clipboard,
      select: () => {
        selections += 1
        return true
      },
    })
    expect(outcome).toBe("selected")
    expect(selections).toBe(1)
  }
})

test("a clipboard without writeText is guarded out too", async () => {
  // Older Safari exposed a clipboard object whose write method was missing;
  // calling it would be a TypeError in the tap handler.
  let selections = 0
  const outcome = await run({
    text: attach,
    clipboard: {},
    select: () => {
      selections += 1
      return true
    },
  })
  expect(outcome).toBe("selected")
  expect(selections).toBe(1)
})

test("the guarded write keeps the clipboard as its receiver", async () => {
  const written: string[] = []
  const clipboard = {
    writeText(text: string) {
      written.push(text + (this === clipboard ? ":bound" : ":unbound"))
      return Promise.resolve()
    },
  }
  const outcome = await run({
    text: attach,
    clipboard,
    select: () => {
      throw new Error("the fallback must not run when the clipboard worked")
    },
  })
  expect(outcome).toBe("copied")
  expect(written).toEqual([attach + ":bound"])
})

test("a working clipboard copies the command and never selects the page", async () => {
  const written: string[] = []
  const outcome = await run({
    text: attach,
    clipboard: {
      writeText: (text) => {
        written.push(text)
        return Promise.resolve()
      },
    },
    select: () => {
      throw new Error("the fallback must not run when the clipboard worked")
    },
  })
  expect(outcome).toBe("copied")
  expect(written).toEqual([attach])
})

test("no clipboard API selects the visible command instead of failing", async () => {
  let selections = 0
  const outcome = await run({
    text: attach,
    select: () => {
      selections += 1
      return true
    },
  })
  expect(outcome).toBe("selected")
  expect(selections).toBe(1)
})

test("a rejected clipboard write (iOS Safari outside a gesture) selects the command", async () => {
  let selections = 0
  const outcome = await run({
    text: attach,
    clipboard: { writeText: () => Promise.reject(new Error("NotAllowedError")) },
    select: () => {
      selections += 1
      return true
    },
  })
  expect(outcome).toBe("selected")
  expect(selections).toBe(1)
})

test("a clipboard that throws before returning a promise still selects the command", async () => {
  // Safari has thrown from `writeText` synchronously when the call was not
  // treated as a user gesture; a rejected promise is not the only shape.
  let selections = 0
  const outcome = await run({
    text: attach,
    clipboard: {
      writeText: () => {
        throw new Error("NotAllowedError")
      },
    },
    select: () => {
      selections += 1
      return true
    },
  })
  expect(outcome).toBe("selected")
  expect(selections).toBe(1)
})

test("a clipboard with nothing to select is the one reported failure", async () => {
  const outcome = await run({
    text: attach,
    clipboard: { writeText: () => Promise.reject(new Error("NotAllowedError")) },
    select: () => false,
  })
  expect(outcome).toBe("unavailable")
})
