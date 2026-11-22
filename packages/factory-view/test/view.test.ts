/* oxlint-disable plumb/prefer-property-tests -- this suite renders one fixed presence document per claim. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Option } from "effect"
import { ClipboardMessage, copyText } from "foldkit-primitives/dom"
import * as Scene from "foldkit/scene"
import { describe, expect, it } from "vitest"
import { type Message, type Model, update, view } from "../src/main.ts"
import { presenceFixture } from "./fixtures.ts"

const modelOf = (presence = presenceFixture()): Model => ({
  presence,
  error: null,
  loading: false,
  notice: null,
})

/** Render the real view through Foldkit's scene harness, then read it as one string. */
const rendered = (model = modelOf()): string => {
  let text = ""
  Scene.scene(
    { update, view },
    Scene.given(model),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      text = Scene.textContent(simulation.html)
      return simulation
    },
  )
  return text
}

const section = (selector: string): string => {
  let text = ""
  Scene.scene(
    { update, view },
    Scene.given(modelOf()),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      const found = Scene.find(simulation.html, selector)
      if (Option.isSome(found)) text = Scene.textContent(found.value)
      return simulation
    },
  )
  return text
}

describe("sessions on the factory view", () => {
  it("renders the address, label, agent, cwd, state and the evidence that joined it", () => {
    const text = rendered()
    expect(text).toContain("herdr t1d")
    expect(text).toContain("factory view / sessions")
    expect(text).toContain("pi")
    expect(text).toContain("/work/tackle/packages/factory-view")
    expect(text).toContain("live")
    expect(text).toContain("cwd")
    expect(text).toContain("rex block:1")
    expect(text).toContain("tackle")
  })

  it("keeps the source's status word beside our normalized badge", () => {
    const text = rendered()
    expect(text).toContain("working")
    expect(text).toContain("done")
    expect(text).toContain("blocked")
    expect(text).toContain("idle")
  })

  it("shows the exact command, not a button that pretends to attach a TTY", () => {
    const text = rendered()
    expect(text).toContain("hc attach t1d")
    expect(text).toContain("rex block focus -s tackle")
    expect(text).not.toContain("Open")
  })

  it("renders a session with no workstream under unjoined, even with no cwd", () => {
    const unjoined = section("#unjoined")
    expect(unjoined).toContain("herdr t9z")
    expect(unjoined).toContain("scratch")
    expect(unjoined).toContain("/Users/t/scratch")
    expect(unjoined).toContain("unjoined")
  })

  it("puts the exact Herdr command on the clipboard when Copy is pressed", () => {
    Scene.scene(
      { update, view },
      Scene.given(modelOf()),
      Scene.click('button[data-copy-command="hc attach t1d"]'),
      Scene.Command.resolve(copyText("hc attach t1d"), ClipboardMessage.Copied()),
      Scene.tap((simulation) => {
        expect(Scene.textContent(simulation.html)).toContain("Copied the attach command")
      }),
    )
  })

  it("puts the exact Rex command on the clipboard when Copy is pressed", () => {
    Scene.scene(
      { update, view },
      Scene.given(modelOf()),
      Scene.click('button[data-copy-command="rex block focus -s tackle"]'),
      Scene.Command.resolve(copyText("rex block focus -s tackle"), ClipboardMessage.Copied()),
      Scene.tap((simulation) => {
        expect(Scene.textContent(simulation.html)).toContain("Copied the attach command")
      }),
    )
  })
})

describe("the view never writes", () => {
  it("has no POST and no /open anywhere in its source", () => {
    const source = ["../src/main.ts", "../src/entry.ts"]
      .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
      .join("\n")
    expect(source).not.toMatch(/\bPOST\b/u)
    expect(source).not.toContain("/open")
  })
})
