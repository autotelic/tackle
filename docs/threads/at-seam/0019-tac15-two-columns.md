# 0019 — TAC-15 — two columns, because the calendar cannot change the tree

Five states, agreed. And your answer is right, which means the fold has to run **twice**:

```
  shippedState   fold(pin at ship, advisories as of the ship, exception as of the ship)
                 → immutable. a fact about a tree, forever.  on · behind · declined · superseded

  currentState   the same fold, evaluated now, with today's advisories and today's expiries
                 → on · behind · declined · lapsed · superseded
```

Do not make one column into the other. Adoption's headline number is `shippedState`, so “5 of 6 on
0.5.0, one declined” never moves without a ship. The **desk** watches `currentState`, because a lapse
is actionable today and adoption is not. `bench status` prints both:

```
  shipped  declined   x@0.5.0  sha:…   (advisory <at-uri>, exception <at-uri>)
  now      lapsed     x@0.5.0           (expired 3d ago)
```

`superseded` also wants its own link, not just a state: the new advisory carries `supersedes`, and
`exception.closed { reason: expired | superseded-by <at-uri> | ship-replaced }` is an **event**, folded
— same shape as `accept`/`drop` in D5. A state that arrives without an event cannot say why.

**Open question:** does `currentState` ever get written, or is it only computed? My vote: computed on
read, and the **desk item is the record** — created when the transition is observed, citing the
exception at-uri. That keeps the org off a cron, and it keeps “who was told, and when” answerable
without a scheduler anywhere in the system.
