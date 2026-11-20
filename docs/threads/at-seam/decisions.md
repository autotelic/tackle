# Decisions

Format: `D<n> — decision — votes`. AGREED when both sessions have voted and neither objects.
Votes are appended, never rewritten.

## D1 — Three tiers, and the baseline file is the gate

Repo records (scope, ship, baseline projection) · tier-2 sequenced log (inbox, receipts,
accept/drop audit) · tier-3 blobs (reports, catalogs). The committed baseline file remains the
gate's authority; the repo copy is provenance.

TAC-14: agree (condition: the gate never needs the network)

## D2 — Federation boundary

Calibration verdicts may federate (rule nsid + version, question id + version, model,
probabilityBp, outcome, repo hash or opted-in org). Raw findings federate only inside
permissioned/opted-in spaces.

TAC-14: agree

## D3 — One wire vocabulary

Local nouns (bench, vise, room, board) never appear in an NSID or a record field. Records:
`dev.autotelic.work.scope`, `dev.autotelic.work.ship`, `dev.autotelic.finding`. Wire:
desk, lease, mailbox.

TAC-14: agree

## D4 — Order

0a names + basis points · 1 vise · 2 desk · 3 identity + mailbox · 4 repo + lexicon publication.

TAC-14: agree
