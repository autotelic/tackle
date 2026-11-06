import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { sentencesOfMarkdown } from "../src/prose.ts"
import { proseVoice } from "../src/rules/prose-voice.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { discoverFiles, loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/prose-voice", ["."])

it("markdown reaches the index as prose, and structure is not prose", () => {
  const document = `# Notes

A printed type cut to the length a finding's help can carry.

\`\`\`ts
const code = "A sentence in a fence."
\`\`\`

| column | a table cell |

- **The notes are not decoration.**
`
  const sentences = sentencesOfMarkdown(document)
  expect(sentences.map((sentence) => sentence.line)).toEqual([3, 11])
  expect(sentences[0]?.text).toBe("A printed type cut to the length a finding's help can carry.")
  expect(sentences[1]?.text).toBe("The notes are not decoration.")
})

it.effect("a workspace carries its markdown sentences", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const document = workspace.prose.find((file) => file.path === "doc.md")
    expect(document?.sentences.length).toBe(2)
    expect(document?.sentences.map((sentence) => sentence.text)).toEqual([
      "A printed type cut to the length a finding's help can carry.",
      "The notes are not decoration, and the funnel is the only thing that says otherwise.",
    ])
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("every sentence the judge calls a riddle is reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(proseVoice, workspace)
    expect(result.diagnostics.length).toBe(4)
    expect(result.diagnostics[0]?.severity).toBe("warn")
    expect(result.diagnostics[0]?.message).toContain("reads as riddle")
    expect(result.diagnostics[0]?.help).toContain("State the behaviour")
  }).pipe(
    Effect.provide(modelStub({ tell: choice("riddle", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a sentence the judge reads as plain is dropped, not printed", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(proseVoice, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.filter((drop) => drop.stage === "declined").length).toBe(4)
  }).pipe(
    Effect.provide(modelStub({ tell: choice("no_issue", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it("every label a judgement may return has a repair message", () => {
  const labels = ["riddle", "verdict", "antithesis", "anthropomorphism", "synonym_rotation", "overgeneralisation", "false_certainty", "restatement"]
  for (const label of labels) {
    expect(proseVoice.messages?.["help_" + label]).toBeDefined()
  }
})

it.effect("only a literal written as a sentence is judged", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/prose-voice-strings", ["."])
    const result = yield* plannedDiagnosticsOf(proseVoice, workspace)
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")
    // The banner above a declaration, a criteria label and a bracket fragment are
    // all filtered by a fact about their text, not by a judgement.
    expect(messages).toContain("Shortens a type for a message.")
    expect(messages).toContain("The notes are not decoration, and the funnel is the only thing that says otherwise.")
    expect(messages).not.toContain("----")
    expect(messages).not.toContain("A requirement the code does not meet")
    expect(messages).not.toContain("relevant to the question")
    expect(result.diagnostics.length).toBe(2)
  }).pipe(
    Effect.provide(modelStub({ tell: choice("riddle", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a caller hands over a document discovery cannot find", () =>
  Effect.gen(function* () {
    const text = "joggle: the funnel is not decoration."
    const workspace = yield* loadWorkspace("tests/fixtures/prose-voice-empty", [], {
      prose: [{ path: "COMMIT_EDITMSG", text, sentences: sentencesOfMarkdown(text) }],
    })
    expect(workspace.prose.map((file) => file.path)).toEqual(["COMMIT_EDITMSG"])
    const result = yield* plannedDiagnosticsOf(proseVoice, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.location.file).toBe("COMMIT_EDITMSG")
  }).pipe(
    Effect.provide(modelStub({ tell: choice("verdict", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("discovery and the load agree about Markdown", () =>
  Effect.gen(function* () {
    const found = yield* discoverFiles("tests/fixtures/prose-voice", ["."], undefined)
    expect(found.prose.length).toBe(1)
    const workspace = yield* loadWorkspace("tests/fixtures/prose-voice", ["."], {
      discovered: found.files,
      proseFiles: found.prose,
    })
    expect(workspace.prose.map((file) => file.path)).toEqual(["doc.md"])
  }).pipe(Effect.provide(NodeServices.layer)),
)

it("a blockquote is one block and a list item opens its own", () => {
  const document = `> The goal beyond the goal is not "fix the findings." It is that the
> proving ground proves itself, and the tools get better for having done it.

- The census first, every round.
- Then the ratchet.`
  const sentences = sentencesOfMarkdown(document)
  expect(sentences.map((sentence) => sentence.text)).toEqual([
    'The goal beyond the goal is not "fix the findings."',
    "It is that the proving ground proves itself, and the tools get better for having done it.",
    "The census first, every round.",
    "Then the ratchet.",
  ])
  expect(sentences.map((sentence) => sentence.paragraph)).toEqual([0, 0, 1, 2])
})
