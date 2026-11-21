# The first intercom-free exchange

`packages/mailbox-server/test/cutover.test.ts` is the receipt. TAC-14 and TAC-15 are two
`Host`s with `did:key` identities; the exchange uses no pi-intercom process and no shared file:

1. TAC-14 publishes `dev.autotelic.work.ship/ship-1` (commit `ac3070b`, checks `pnpm check`),
   yielding an `at://` URI and a DAG-CBOR CID.
2. TAC-15 ingests the record and resolves it by URI and by CID.
3. TAC-14 seals a review request to TAC-15's HPKE key; TAC-15 admits it, delivers it under its
   lease, and acks it.
4. TAC-15 publishes `dev.autotelic.work.ack/ack-1` citing the message and the ship CID.
5. TAC-14 ingests and resolves the answer.

Both sides hold the record and the receipt. The doorbell changed; the substance did not.

What is not claimed: pi-intercom is still the live way two sessions talk today. This exchange is
the proof that the mailbox/desk stack can carry it once the host is serving; it is not a claim
that the host has replaced the tool in daily use.
