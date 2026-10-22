# Content mappers

TypeScript 7.1 lets a project register a **content mapper** for a foreign file
extension. The mapper turns `.vue`, `.svelte`, `.mdx` or similar into virtual
TypeScript and supplies span maps back to the original file. `tsc` then checks
the virtual text, and `--runExternalCode` is what permits it to execute the
mapper process.

joggle does not implement a mapper, and plumb cannot see one. This note records
what each does with them, and what remains open.

## plumb

Nothing. plumb is an Oxlint plugin: Oxlint parses one file with its own parser,
so it has no `Program`, no virtual source, and no span map. A plumb rule for
mapped files would be a second parser inside a lint rule, which is the coupling
`rule-coupling.md` rejects. The mapped TypeScript is the input; the single-file
format is not a code pattern plumb should judge.

The one plumb-adjacent concern is generated output. With `--declaration`,
content mappers emit `App.d.svelte.ts` (and `App.svelte.0.d.ts`). Those are build
artifacts. A repository that lints them is linting the mapper's scaffolding.

## joggle

joggle does three things, and one of them is deliberately incomplete.

### It reports what it did not index

`src/content-mappers.ts` reads `contentMappers` from the tsconfig chain,
following relative `extends` and accepting JSONC (comments and trailing commas).
`check` emits a note naming every declared extension joggle cannot parse:

```text
note: joggle — tsconfig declares content mappers for .vue; joggle indexes
TypeScript and Astro only, so those files are not in the rule report (tsc did
not run them either: pass --run-external-code to enable the mapper)
```

The note is the point. A file count that silently omits a third of the tree is
the failure `src/source.ts` exists to prevent, and enabling the compiler does not
teach joggle's parser a new format.

### It runs the compiler only when asked

`--run-external-code`, or `"runExternalCode": true` in `joggle.config.json`,
passes the flag to every `tsc` invocation (`--listFilesOnly`, `--noEmit`,
`--generateTrace`). It is off by default because a mapper is arbitrary code
named by the repository: a cloned tree should not make an agent execute it. The
host owns that trust decision, the same way VS Code gates content mappers behind
workspace trust.

```json
{
  "runExternalCode": true
}
```

### It excludes generated declarations

`looksLikeSource` already excluded `.d.ts`, `.d.mts` and `.d.cts`. It now also
excludes `*.d.<ext>.ts`, the shape a content mapper emits for a mapped file
(`App.d.svelte.ts`). Without that, a declaration build would be analysed as
authored source.

## What is still open

- **Indexing mapped files.** joggle checks declarations through its own oxc
  parser, not through TypeScript's virtual program. Content mappers give the
  compiler a view of a `.vue` file; they do not give joggle a declaration graph.
  To index mapped files, joggle would parse the mapper's virtual text and map
  locations back through `spanMap` (`file.text`, `file.originalText`,
  `file.supplementalOutputs`). That is the same work as replacing the bespoke
  `src/astro.ts` region parser with the Astro mapper, and it is only worth doing
  when a repository actually depends on SFCs.
- **The 7.1 API.** `src/typefacts.ts` uses `@typescript/native/unstable/async`.
  TS 7.1 moves the API to `typescript/sync` and `typescript/async`, and mapped
  files expose span maps. The workspace pins `@typescript/native@7.0.2`, so this
  is a migration, not a flag.
- **`include`/`exclude` through `extends`.** `src/tsconfig-scope.ts` still reads
  only the root file. The mapper scan follows `extends`; the scope scan does not.
  That is a separate, older gap.

## Why the CLIs do not set it up

`jig init` writes `jig.config.json`, a baseline and the agent docs. It does not
touch `tsconfig.json`, and it should not: choosing a mapper package per format
and opting into `--runExternalCode` is a repository's trust decision, not a
scaffold default. joggle has no init command. Both surface the coverage note
instead — joggle in its report, jig on the engine's census line.
