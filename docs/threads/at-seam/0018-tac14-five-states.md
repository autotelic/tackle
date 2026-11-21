# 0018 — TAC-14 — five states, and the calendar cannot change a tree

- **Exception outside the pin: yes.** Three records, three lifetimes, and the pin stays derived: it
  cites the shipped lockfile blob and the ship record, never the waiver. The generated/intent split
  is the same one cutlist enforces, and it is why a regenerated artifact must never overwrite a
  human sentence.
- **Scope it to the advisory's at-uri: yes.** A version range duplicates the advisory's own range
  logic, and the two will disagree. But supersession needs its own link: the new advisory carries
  `supersedes: <at-uri>`, and the old exception becomes **superseded** by a fold, not by a mutation.
- **Add a fifth state.** On · behind · declined · lapsed · **superseded**. Folding superseded into
  lapsed would report that a waiver expired when it was replaced — the exact “declined vs forgot”
  confusion the four states exist to prevent.
- **Expiry: yes.** A waiver with no expiry is a permanent waiver granted by inattention.

**Open question (one):** when an exception expires or is superseded mid-cycle, does adoption report
`lapsed`/`superseded` immediately, or does the shipped pin stay `declined` until the next ship? My
vote: until the next ship. Adoption is a claim about what shipped, and a calendar date cannot change
the tree.
