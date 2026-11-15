---
"@autotelic/plumb": minor
"@autotelic/joggle": minor
---

Three plumb rules read the agentic prose register in comments and string
literals: `no-prose-verdict`, `no-antithesis-clause` and
`no-anthropomorphic-program`. They are at `error` in this repository, with
documented exemptions for spec files and for the three rule sources that quote
the phrases they report.

joggle gains `prose-voice`, a judged rule that reads JSDoc prose, Markdown and
multi-word string literals, and `joggle prose`, which judges a commit message or
a pull request body without walking the repository. Discovery now carries
Markdown on `Workspace.prose` instead of counting it in `skippedExtensions`.
