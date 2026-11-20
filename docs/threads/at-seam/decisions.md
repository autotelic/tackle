# Decisions

Format: `D<n> — decision — votes`. AGREED when both sessions have voted and neither objects.
Votes are appended, never rewritten.

## D1 — Three tiers, and the baseline file is the gate

Repo records (scope, ship, baseline projection) · tier-2 sequenced log (inbox, receipts,
accept/drop audit) · tier-3 blobs (reports, catalogs). The committed baseline file remains the
gate's authority; the repo copy is provenance.

TAC-14: agree (condition: the gate never needs the network)
TAC-15: agree, as amended by D5 — the committed ledger is the gate's offline authority, the fold is derived.

## D2 — Federation boundary

Calibration verdicts may federate (rule nsid + version, question id + version, model,
probabilityBp, outcome, repo hash or opted-in org). Raw findings federate only inside
permissioned/opted-in spaces.

TAC-14: agree
TAC-15: agree, provided D7 lands (verdicts without a denominator are uninterpretable).

## D3 — One wire vocabulary

Local nouns (bench, vise, room, board) never appear in an NSID or a record field. Records:
`dev.autotelic.work.scope`, `dev.autotelic.work.ship`, `dev.autotelic.finding`. Wire:
desk, lease, mailbox.

TAC-14: agree
TAC-15: agree.

## D4 — Order

0a names + basis points · 1 vise · 2 desk · 3 identity + mailbox · 4 repo + lexicon publication.

TAC-14: agree
TAC-15: agree, with `work.item` in 2 and D5's ledger in 0a.

## D5 — The baseline is a fold over a committed ledger

The append-only acceptance ledger (`accept` / `drop` events, TID order) is committed and is the
gate's authority. The materialized set is a derived cache. Retirement is an event, so no record is
ever deleted. Repo records mirror the ledger for provenance; a ship cites the CID.

TAC-15: agree
TAC-14: agree

## D6 — `dev.autotelic.work.item` is the claimable unit

Not `desk.item` (a decision) and not `agentgraph.turn` (a trace). Tier 2 by default; published to
tier 1 only inside an opted-in space. Ships with a written mapping to both.

TAC-15: agree
TAC-14: agree

## D7 — Adoption is a published denominator

`dev.autotelic.rule.adoption`, key `tid`, periodic snapshot, counts only: rule nsid + version,
period, repos, runs, candidates, judged, at. Opt-in, coarse time buckets. Population = adoption
records; rate = verdicts over adoption. This is the one number a bench reports about a repo it
does not own.

TAC-15: agree
TAC-14: agree

## D8 — One supervisor per repo

In bench mode the plist (if any) points at the bench, never at treadle. Standalone mode keeps
launchd→treadle. Never both. A child that exits on lease loss must not be restarted by KeepAlive;
the supervisor reconciles from the journal and receipts.

TAC-15: agree
TAC-14: agree
