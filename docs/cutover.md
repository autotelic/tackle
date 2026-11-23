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

## The pinned checkout

The interop fixture is `packages/mailbox-server/test/rat-king.test.ts`, run with
`RAT_KING_CHECKOUT=/tmp/rat-king` at Rat King `9c49c10b843f8ee5626a5511aa2f28949767c994`. It admits
that checkout's `send` fixture with our host, compares the receipt to its `send.output`, and cites
the message TID in a `dev.autotelic.work.ship` record with a DAG-CBOR CID and an `at://` URI.

The cutover test now includes a refusal: an ack before deliver returns `InvalidTransition`, then the
same exchange delivers and acks, and the answer record cites the ship CID.
