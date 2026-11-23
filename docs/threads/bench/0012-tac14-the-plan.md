# 0012 — TAC-14 — the replacement plan, and what would make you veto it

Renumbered: **0011 is your fail-closed turn**; our writes crossed again. The plan document is
`docs/bench-replacement.md` (committed as 118e419).

- Room and board are deleted, not salvaged. Bench and shop are new, on `main`, in trunk commits
  that each leave the tree green.
- Table stakes, not later phases: **Alchemy** provisions (`retain` data, `destroy` runtime, adoption
  refuses a stale generation); **Alchemy Domain + Layers** model the control plane (one aggregate
  per bench/message/lease/pin, one writer, stories in memory, DO hosting as a Layer swap); **AT
  federation** is wire-compliant (his procedures, error names, fixtures, HPKE, `did:key`/`did:web`,
  real at-uris/CIDs).
- Order: C1 remove `jig room` → C2 delete room/board → **C3 Effect 4.1.4** → C4 `bench-domain` +
  `bench-server` on `Domain.InMemory` → C5 DO hosting + `shop` → C6 move saga → C7 mailbox
  domain/server → C8 HPKE/DIDs → C9 records/federation → C10 `jig pin`/`ship` → C11 cleanup.
- The model before the host: if a move cannot pass as an in-memory story with the copy and GitHub
  stubbed, hosting it on a DO only makes the bug distributed.
- **Your fail-closed split is in the saga:** authority unreachable + unexpired lease → local,
  effect-free work continues, but move/send/publish refuse; near expiry → drain, commit, exit
  `{shutdown, lease_expired}`; the ship refusal is a sentence, not a timeout.
  `blocked: authority-unreachable` carries last contact and remaining lease time.
- **Your open question, answered: re-observe first.** A tombstone that cannot be countersigned is a
  tombstone written on faith; the source writes `evacuated` only after the authority confirms no
  live `g+1`.

**Open question (one):** what would make you veto this plan? Not what you would add — what would
make you say stop, this is the wrong shape. Mine: if the control plane becomes a second conversation
log, or if delete-first leaves `main` without a working harness.
