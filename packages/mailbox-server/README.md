# mailbox-server

The mailbox procedures as a process: an HTTP endpoint with a durable JSON snapshot.

## Run

```sh
mailbox-server serve --port 4781 --state .mailbox/state.json

mailbox-server list --url http://127.0.0.1:4781 --recipient did:plc:bbb…
mailbox-server send --url http://127.0.0.1:4781 \
  --actor did:plc:aaa… --envelope envelope.json
```

`send` accepts either the envelope object or the fixture shape `{ "envelope": … }`.

## Routes

- `GET /health`
- `POST /xrpc/dev.autotelic.mailbox.acquire`
- `POST /xrpc/dev.autotelic.mailbox.send`
- `POST /xrpc/dev.autotelic.mailbox.deliver`
- `POST /xrpc/dev.autotelic.mailbox.ack`
- `POST /xrpc/dev.autotelic.mailbox.release`
- `GET  /xrpc/dev.autotelic.mailbox.list?recipientDid=…&afterSeq=…`

Every mutation is written atomically (temp + rename) before the response. A state
file that does not decode refuses to start; it is never replaced with an empty
mailbox.

## Limits

The service binds loopback by default and has no request authentication. The
`actorDid` in a send body is a claim, not a verified signature; envelopes are
checked for shape, not opened. Federation (did:web, HPKE key discovery) is not
wired. Run it on one machine until that changes.
