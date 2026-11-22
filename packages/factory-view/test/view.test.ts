/* oxlint-disable plumb/prefer-property-tests -- one fixed presence document renders the disclosure states. */
import { test } from "node:test"
import { Scene } from "foldkit/test"
import { CopyCommand, Message, init, update, view, type Model } from "../src/main.ts"

/**
 * A presence document shaped like the board's `/presence`: two repos, one
 * workstream each, one matched Herdr session, one reply-less desk question.
 */
const presence = {
  factory: {
    workstreams: [
      {
        id: "perms-1862",
        project: "factory",
        label: "Permissions overhaul",
        phase: "build",
        path: "/work/perms-1862",
        repo: "acme/web",
        branch: "perms",
        pr: 1862,
        checkpoint: { sha: "abcdef1234567890", at: "2026-11-21T18:00:00.000Z" },
      },
      {
        id: "enterprise-1854",
        project: "factory",
        label: "Enterprise readiness",
        phase: "land",
        path: "/work/enterprise-1854",
        repo: "acme/api",
        checkpoint: { sha: "1234567890abcdef", at: "2026-11-21T17:00:00.000Z" },
      },
    ],
    activity: [
      {
        workstream: "perms-1862",
        lastPass: {
          pass: 5,
          at: "2026-11-21T21:48:00.000Z",
          status: "passed",
          phase: "build",
          events: [],
          quality: {
            before: { available: true, errors: 4, warnings: 2, note: "" },
            after: { available: true, errors: 2, warnings: 2, note: "" },
            regressed: false,
          },
        },
        pending: [],
        lastEvent: null,
        ageMinutes: 12,
      },
    ],
    desk: [{ id: "d1", workstream: "perms-1862", title: "Merge it?", route: "/desk/d1" }],
    reports: [
      {
        id: "r1",
        workstream: "perms-1862",
        kind: "quality",
        actual: "2 errors remain",
        at: "2026-11-21T21:00:00.000Z",
        blocked: false,
      },
    ],
  },
  sessions: {
    herdr: {
      available: true,
      sessions: [
        { source: "herdr", address: "t1d", where: "perms-1862", workstream: "perms-1862" },
      ],
    },
    rex: { available: true, sessions: [] },
  },
}

const modelAt = (value: typeof presence): Model =>
  update(init().model, Message.Settled({ value, error: null })).model

void test("a phone sees the repo panels, and a workstream's detail is one tap away", () => {
  Scene.scene(
    { update, view },
    Scene.given(modelAt(presence)),
    // The repo is a disclosure that starts open; the workstream starts closed.
    Scene.expect(Scene.role("button", { name: "Hide acme/web workstreams" })).toHaveAttr(
      "aria-expanded",
      "true",
    ),
    Scene.expect(Scene.text("acme/web")).toExist(),
    Scene.expect(Scene.text("Permissions overhaul")).toExist(),
    Scene.expect(Scene.text("checkpoint abcdef12")).toExist(),
    Scene.expect(Scene.text("hc attach t1d")).toBeAbsent(),
    Scene.expect(Scene.role("button", { name: "Show Permissions overhaul details" })).toHaveAttr(
      "aria-expanded",
      "false",
    ),
    Scene.click(Scene.role("button", { name: "Show Permissions overhaul details" })),
    Scene.expect(Scene.role("button", { name: "Hide Permissions overhaul details" })).toHaveAttr(
      "aria-expanded",
      "true",
    ),
    Scene.expect(Scene.text("hc attach t1d")).toExist(),
    Scene.expect(Scene.role("button", { name: "Copy the attach command for t1d" })).toExist(),
  )
})

void test("a repo collapses on a tap, with no hover in the path", () => {
  Scene.scene(
    { update, view },
    Scene.given(modelAt(presence)),
    Scene.expect(Scene.text("Permissions overhaul")).toExist(),
    Scene.click(Scene.role("button", { name: "Hide acme/web workstreams" })),
    Scene.expect(Scene.role("button", { name: "Show acme/web workstreams" })).toHaveAttr(
      "aria-expanded",
      "false",
    ),
    Scene.expect(Scene.text("Permissions overhaul")).toBeAbsent(),
    Scene.expect(Scene.text("Enterprise readiness")).toExist(),
  )
})

void test("a desk question opens the workstream it names", () => {
  Scene.scene(
    { update, view },
    Scene.given(modelAt(presence)),
    Scene.expect(Scene.text("hc attach t1d")).toBeAbsent(),
    Scene.click(Scene.role("link", { name: "perms-1862" })),
    Scene.expect(Scene.role("button", { name: "Hide Permissions overhaul details" })).toExist(),
    Scene.expect(Scene.text("hc attach t1d")).toExist(),
  )
})

void test("Copy dispatches the attach command, and the outcome lands in the notice", () => {
  Scene.scene(
    { update, view },
    Scene.given(modelAt(presence)),
    Scene.click(Scene.role("button", { name: "Show Permissions overhaul details" })),
    Scene.click(Scene.role("button", { name: "Copy the attach command for t1d" })),
    Scene.Command.resolve(
      CopyCommand({ text: "hc attach t1d", target: "copy-herdr-t1d" }),
      Message.Copied(),
    ),
    Scene.expect(Scene.text("Copied the attach command")).toExist(),
  )
})

void test("a selection fallback is reported as a selection, not a copy", () => {
  Scene.scene(
    { update, view },
    Scene.given(modelAt(presence)),
    Scene.click(Scene.role("button", { name: "Show Permissions overhaul details" })),
    Scene.click(Scene.role("button", { name: "Copy the attach command for t1d" })),
    Scene.Command.resolve(
      CopyCommand({ text: "hc attach t1d", target: "copy-herdr-t1d" }),
      Message.Selected(),
    ),
    Scene.expect(Scene.text("Selected the command — copy it from the selection")).toExist(),
  )
})
