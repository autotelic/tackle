---
"@autotelic/jig-cli": minor
---

`jig init` can make the harness real: a scoped pre-commit hook, and the ignore lines that hide it.

The two are separate decisions and both are opt-in, because either one changes what everyone on
the repository experiences:

- `--unignore` removes the exact `.gitignore` lines that hide the harness. A path hidden by a
  _pattern_ is reported, never edited — nothing here rewrites a glob — and the summary says which
  ones need a person.
- `--hooks` writes `.git/hooks/pre-commit` running `jig check --gate touched-files`, which is the
  scoped gate that already exists. It steps aside **loudly** when the CLI is not on the machine,
  because a hook that fails for a contributor without the harness turns a local-only gate into a
  hostile one; and it never replaces a hook that is not jig's.

The generated prompt's commit step now teaches both, with the stop-and-ask that goes with them.
