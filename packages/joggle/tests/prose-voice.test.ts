import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { DecisionModel } from "effect/ai"
import { NodeServices } from "@effect/platform-node"
import { hasWords, readsAsProse, sentencesOfMarkdown } from "../src/prose.ts"
import { proseVoice } from "../src/rules/prose-voice.ts"
import { atomsLayer, planAnswersLayer, plannedDiagnosticsOf } from "../src/testing.ts"
import { discoverFiles, loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/prose-voice", ["."])

/** The labels the rule had before the semantic layer, and the six it gained. */
const EXISTING_LABELS = [
  "riddle",
  "verdict",
  "antithesis",
  "anthropomorphism",
  "synonym_rotation",
  "overgeneralisation",
  "false_certainty",
  "restatement",
] as const

const SEMANTIC_LABELS = [
  "compression",
  "stacked_nouns",
  "reduced_relative",
  "inanimate_subject",
  "denominal",
  "long_dependency",
] as const

/**
 * A model that records the voice question's options and declines every sentence.
 *
 * The question is the only place a label can enter the rule, so the options a
 * run actually sends are the vocabulary the judge sees. Reading them back is the
 * test that a repair the rule can print has a criterion the judge can pick.
 */
const captureVoiceQuestion = (seen: Array<ReadonlyArray<string>>) =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: ({ decisions }) =>
        Effect.sync(() => {
          const answers: Record<string, DecisionModel.ProviderAnswer> = {}
          for (const [key, decision] of Object.entries(decisions)) {
            if (decision._tag !== "Classify") continue
            const labels = Object.keys(decision.criteria)
            seen.push(labels)
            const remainder = 0.05 / Math.max(1, labels.length - 1)
            answers[key] = {
              _tag: "Classify",
              label: "no_issue",
              probabilities: Object.fromEntries(
                labels.map((label) => [label, label === "no_issue" ? 0.95 : remainder]),
              ),
              confidence: 0.95,
            }
          }
          return { answers, usage: { inputTokens: 0, outputTokens: 0 } }
        }),
    }),
  )

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
  for (const label of [...EXISTING_LABELS, ...SEMANTIC_LABELS]) {
    expect(proseVoice.messages?.["help_" + label]).toBeDefined()
  }
})

it.effect("the question offers a criterion for every label the rule repairs", () => {
  const seen: Array<ReadonlyArray<string>> = []
  return Effect.gen(function* () {
    // Two sentences in one paragraph, so the neighbour-gated `restatement` option
    // is actually offered. The fixture has one sentence per block.
    const text = "The notes are not decoration, ever. The funnel is the only thing that says otherwise."
    const workspace = yield* loadWorkspace("tests/fixtures/prose-voice-empty", [], {
      prose: [{ path: "NOTES.md", text, sentences: sentencesOfMarkdown(text) }],
    })
    yield* plannedDiagnosticsOf(proseVoice, workspace)
    expect(seen.length).toBe(2)
    const offered = new Set(seen.flatMap((criteria) => criteria))
    for (const label of [...EXISTING_LABELS, ...SEMANTIC_LABELS]) {
      expect(offered.has(label), label).toBe(true)
    }
    expect(offered.has("no_issue")).toBe(true)
    const repaired = Object.keys(proseVoice.messages ?? {})
      .filter((key) => key.startsWith("help_"))
      .map((key) => key.slice("help_".length))
      .sort()
    expect([...offered].filter((label) => label !== "no_issue").sort()).toEqual(repaired)
  }).pipe(
    Effect.provide(Layer.mergeAll(captureVoiceQuestion(seen), atomsLayer, planAnswersLayer)),
    Effect.provide(NodeServices.layer),
  )
})

it.effect("each semantic label reaches a finding with its own repair", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/prose-voice-labels", ["."])
    expect(workspace.prose[0]?.sentences.length).toBe(SEMANTIC_LABELS.length)
    for (const label of SEMANTIC_LABELS) {
      const result = yield* plannedDiagnosticsOf(proseVoice, workspace).pipe(
        Effect.provide(modelStub({ tell: choice(label, 0.95) })),
      )
      expect(result.diagnostics.length, label).toBe(SEMANTIC_LABELS.length)
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.message).toContain("reads as " + label.replace(/_/g, " "))
        expect(diagnostic.help).toBe(proseVoice.messages?.["help_" + label])
      }
    }
  }).pipe(Effect.provide(NodeServices.layer)),
)

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

it("the candidate filter accepts every sentence the runs reported", () => {
  // Sentences these runs reported, so a judge has to see them.
  const reported = [
    "A printed type cut to the length a finding's help can carry.",
    "Content-addressed rather than positional, and that is the whole point.",
    "It is the point of the whole machine.",
    "256 files is enough granularity.",
    "Run everything and print the census.",
  ]
  // An identifier, a path, a fragment, a field and a banner. None is a sentence.
  const notProse = [
    "no_issue",
    "src/rules/prose-voice.ts",
    "]\` relevant to the question in \`query\`?",
    "a requirement the code does not meet",
    " member list(s) were cut to the evidence budget",
    "--------------------------------------------------------------------------",
    "The printed type is longer than this and ends without a terminator",
  ]
  for (const sentence of reported) expect(readsAsProse(sentence)).toBe(true)
  for (const text of notProse) expect(readsAsProse(text)).toBe(false)
})

it("a section banner is not words", () => {
  expect(hasWords("/* ---- Pruning ---- */")).toBe(false)
  expect(hasWords("256 files is enough granularity.")).toBe(true)
})

it.effect("a document outside the root keeps its own path", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/prose-voice-empty", [], {
      proseFiles: ["tests/fixtures/prose-voice/doc.md"],
    })
    const document = workspace.prose[0]
    expect(document?.path.startsWith("/")).toBe(true)
    expect(document?.sentences.length).toBe(2)
  }).pipe(Effect.provide(NodeServices.layer)),
)
