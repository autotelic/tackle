# @autotelic/board

The room's records and invariants. No dependencies, no runtime — the bytes the room, the
daemon, and a second client agree on.

```ts
chit      a unit of work: a review thread, a build, an external change
claim     the right to act, with a fencing epoch and an expiry
job       one dispatch of a machine: review, fix, build
receipt   a fact that happened, appended after the effect
presence  a heartbeat with a TTL
```

Identity is derived, never entered:

```
room   linear:<projectId>@<stage>
actor  github:<login>
host   <login>@<hostname>
job    pr:<number>:<headSha>
chit   <ticket>@<pr>#<path>:<line>
marker <!-- room:<room> sha:<headSha> -->
```

The invariants live in `invariants.ts` and are pure:

- a chit has exactly one live claimant, or none;
- the next epoch is one past every epoch ever seen, including expired ones;
- a claim is free when it expires, but its epoch still fences the old holder;
- an effect has an older intent, and a job id is one PR head.

`decode*.ts` never throws: a record that says nothing usable is `undefined`, and a malformed
optional field degrades instead of taking the record with it.
