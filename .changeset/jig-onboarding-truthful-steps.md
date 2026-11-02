---
"@autotelic/jig-cli": minor
---

`jig` now tells an adopter the truth about what it wrote, and answers to every name a report prints.

The first adopter run (shakti-v2) surfaced six things a prompt could not fix by prose alone:

- **`init` reports gitignored output.** It writes a config, two docs, a ledger, and a
  generated block; that repository ignores all seven, so the harness was local-only and nothing
  said so. `init` now asks `git check-ignore` about what it wrote, reports the paths in its
  summary, and adds a note; the pasted prompt has a step that stops when the harness cannot be
  committed.
- **`init` notices another ledger.** A repo that already gates findings with its own baseline
  gets a note naming it and asking which ledger owns the findings, instead of a second silent
  ledger.
- **Next steps print an invocation a person can type.** When the project has its own
  `node_modules/.bin/cutlist`, the steps say `pnpm exec cutlist build`, not `cutlist build`
  (127: command not found).
- **`explain` accepts all three spellings of one rule**: the bare id, the id the JSON report
  carries, and the id the human report prints. Only the printed one resolved before.
- **`menu` reads the configured `cutlist` engine's `--cwd`.** A repo that catalogues a
  subdirectory used to report "no cutlist artifact" while `jig menu --cwd examples/self`
  worked; the engine now decides where the artifact lives.
- **The prompt emits one branch per step**, names the unpublished-package workaround (link the
  checkout; `pi install <unpublished-name>` is treated as a relative path), says that an
  OpenCode config denying tools wholesale hides the plugin's tools, and records that secrets are
  two nested layers at most and must be entered from each layer's own root.

jig's pi extension also restores `HOME` when the host hands over an environment without it —
`pi.exec` takes no `env`, and a launcher such as Doppler finds its auth there. `SECRETS.md`
gains the two-layer recipe and the four rules that follow from Doppler's working-directory
resolution.
