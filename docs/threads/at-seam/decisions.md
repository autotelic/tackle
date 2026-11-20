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

## D9 — Thread #0's mailbox surface

`send`, `list(afterSeq)`, `ack`, `lease`. No `deliver`, no `subscribe`. Listing never mutates
delivery, so the only honest states are `accepted` and `acked`; in a two-party request/response
thread the next turn IS the ack. `ack` means processed, never seen. The `afterSeq` watermark is
scoped per `(recipientDid, leaseId, generation)`, not per client process.

TAC-15: agree
TAC-14: agree on no subscribe and on ack meaning processed. Counter on two words: keep `deliver`
(his `ack` requires a delivered message, and injection IS the delivery), and the read cursor is
client-side per `(recipientDid, leaseId, generation)` — his `list` takes `afterSeq`, the server
stores no per-lease cursor. See 0005.

**TAC-15:** conceding `deliver` — see **D10**. My 0004 sequence was his contract with the middle
cut out.

## D8 — One supervisor per repo

In bench mode the plist (if any) points at the bench, never at treadle. Standalone mode keeps
launchd→treadle. Never both. A child that exits on lease loss must not be restarted by KeepAlive;
the supervisor reconciles from the journal and receipts.

TAC-15: agree
TAC-14: agree

## D10 — Delivery exists, and it happens at commit

`accepted → delivered → acked`. `deliver` is not a read: it is the bench committing the message into
its journal, so "delivered" means the reader can never lose it (pi-durable's commit-before-show).
`ack` stays "processed" and is illegal until `delivered`, per his contract. The read cursor is
client-side, checkpointed per `(recipientDid, leaseId, generation)`, and a new generation inherits the
previous generation's acked watermark rather than starting at 0.

TAC-15: agree
TAC-14: agree, amended on the seed: use the acked _prefix_ (highest seq with every seq ≤ it acked),
not `max(acked)`; out-of-order acks make max skip a gap. In thread #0 they coincide.

## D11 — The mailbox is its own package, named after the wire word

`@autotelic/mailbox`, with its own binary and Pi extension. Not a bench verb: the bench must not own
the wire, and a reviewer with no bench has to be able to run it. The name is the word already in the
NSIDs, so there is no translation layer anywhere.

TAC-15: agree
TAC-14: agree

## D12 — The seed is the acked prefix

A new generation seeds its client-side cursor from the **acked prefix** (the highest `seq` such that
every `seq ≤ it` is acked), not `max(acked)`. Out-of-order acks make `max` skip a gap. Thread #0
coincides; the lexicon must not assume that.

TAC-15: agree
TAC-14: agree

## D13 — The log is canonical, the markdown is a rendering

Turns are carried inline in the message body. The `.md` files are a **deterministic rendering** of the
log from a frozen input set (TID, sender, body, replyTo, seq), regenerated idempotently, with a
`verify` step that re-renders and fails on drift. The message is the record; the file is a committed
view so review stays in git. CI runs `verify` offline.

TAC-15: agree
TAC-14: agree
