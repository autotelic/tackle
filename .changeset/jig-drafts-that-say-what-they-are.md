---
"@autotelic/jig-cli": patch
---

`jig init` drafts vocabulary that says what it is, and picks the root that owns the design
system instead of the first one alphabetically.

From the third adopter run (shakti-v2, tackle @ `545925b`):

- **Architecture is split and not enforced.** A UI root that owns `components/ui`,
  `components`, and `routes` becomes three layers instead of one `services/ui/**` — the
  direction most findings live in is invisible from a single layer. The draft still writes no
  `forbid` and does not claim an order, so `joggle/layer-direction` and `joggle/layer-purity`
  are written `off` with the reason: an alphabetical draft that reports 0 findings reads as a
  clean architecture when nothing was checked.
- **The prompt mentions it.** `ONBOARD.md` now has the architecture paragraph the cutlist
  draft already had: includes only, order and `forbid` are yours, turn the rules on after.
- **`tokens` scores the roots.** `:root` in the CSS entry (+3), the custom properties it
  declares, and the colour keys in that root's tailwind config decide which app owns the design
  system; `from` and `vars` are written together and a note names the root left out with its
  numbers (31 tokens instead of 7 on the adopter's two-app repo).
- **A ledger that can be committed while its rulebook cannot is reported.** `init` now asks
  `git check-ignore` about the configs too, and says when the record would travel without the
  rules that produced it.
- **`jig engines` names defaults.** With no `jig.config.json`, the table says so instead of
  presenting jig's defaults under a step that reads "confirm every configured engine resolves".
- **`explain` resolves engine-namespaced ids.** `plumb-effect/require-…` where `plumb-effect`
  is the engine, not a configured engine id, now matches the diagnostic instead of reporting
  "no configured engine named".
- **Docs name `pnpm exec jig` for machine output.** `pnpm jig check --format json` puts pnpm's
  own engine warning on stdout and corrupts the document.
