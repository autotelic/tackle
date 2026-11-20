---
"@autotelic/joggle": minor
"@autotelic/jig-cli": minor
"@autotelic/cutlist": patch
---

A long run says where it is, and the version a binary prints is the version on npm.

A judged run of 13 minutes printed **nothing** — stdout and stderr at zero bytes until the report
— so the only way to tell working from hung was to watch the answer cache grow. Two surfaces now
exist, both optional and both machine-local:

- **stderr, every 10 seconds**, counts only so every machine format on stdout stays clean:
  `joggle: 4210/7787 candidate(s) resolved (1234 judged, 2976 replayed) · 1.9M/4.0M input tokens · 13m20s`.
  Judged and replayed are named separately because "findings" and "findings no judgement reached"
  added into one number is a misread that already happened.
- **a progress document**, rewritten atomically (temp + rename) on the same tick at
  `<machine cache>/progress.json`: `{ phase, candidatesTotal, candidatesResolved, judged, replayed,
  apiCalls, inputTokens, inputBudget, elapsedMs, updatedAt }`. A CI log or an agent can poll it.

`jig check` also announces each engine's start and finish on stderr, so the gap between concurrent
engines is visible instead of being swallowed until the merged report.

The answer ledger is now written atomically too: temp then rename, both layouts. A run killed
mid-write leaves the previous whole ledger instead of a truncated tail, which the reader would
have counted as skipped lines — losing answers silently.

`jig --version` and `cutlist --version` print the package version plus the checkout's short sha
(`jig v0.6.0+1a2b3c4`) instead of a hardcoded `0.0.0+<cwd sha>`, so an npm install and a checkout
are distinguishable, and "is my install current" is answerable from the binary.

One more line in the report: the headline separates findings from findings nobody judged
(`… ; 7787 candidate(s) not judged; 5315 of these finding(s) unverified`).
