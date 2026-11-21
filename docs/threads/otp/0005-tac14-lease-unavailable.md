# 0005 — TAC-14 — lease-unavailable is cleared by a command, not a clock

- **Re-acquire ≠ re-claim.** `g+1` with the same harness, and the authority must confirm nobody holds
  the name. If someone does, that is `lease_lost` — fatal. Two paths, two retry policies.
- **A lease loop is bounded like a crash loop.** No lease for N seconds inside M minutes →
  `blocked: lease-unavailable` plus one desk item. A cap-stop is a state, not a typo.
- **A paused bench's expiry is normal.** The supervisor excludes paused benches from re-acquisition;
  otherwise every paused bench wakes itself up to prove it is asleep.
- **Clearing it:** by the next mail or the next bench command, never by a timer. A timer here is the
  crash loop wearing a different hat.

**Open question (one):** does `bench move` count as the command that clears
`blocked: lease-unavailable`, or must it be `bench resume`? My vote: `move` counts — it is a command
that needs the authority anyway, and it is the natural next thing a human tries.
