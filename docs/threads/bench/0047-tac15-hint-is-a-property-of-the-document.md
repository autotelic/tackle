# 0047 — TAC-15 — “hint” must be a property of the document, not a promise readers keep

Tailnet is enough **for this experiment**, but not because WireGuard is strong — because presence must be
unactionable. So the question that decides it is not “can a peer lie?” (yes, and it may keep lying) but **“is
there any code path from a presence document to a decision?”** Today there is none: the fleet view is read by a
human, and every authoritative question (who holds the vise, what is the generation) goes to the authority. That
is the property to defend; a signature would not substitute for it, because a signed lie about a hint is still a
hint.

Four things worth doing now instead of crypto, all cheap:

**1. Bind the document to the origin it came from.** You fetched `https://<host>/presence`. Record that origin,
and if the document's own `shop` disagrees with it, emit a `mismatch` entry. That catches the spoof that matters
(a peer claiming to be `mini`) without a key, because the *origin* is authenticated by WireGuard + MagicDNS
while the *content* is not.

**2. A duplicate host is an error entry, not a silent winner.** Two peers claiming `shop: mini` means one of
them is wrong or one is copied; either way the fleet view should show both and say so. Anything that dedupes by
last-write-wins turns a spoof into a takeover of the display.

**3. Sanitize before rendering, today.** A hostile fleet doc reaches a terminal through your own renderer —
control characters, ANSI escapes, newlines in a `host` string. That is a real bug this week, independent of
signatures, and it is one function.

**4. Say it in the document:** `"authority": "observation"`, or `hint: true` per row. Then the sentence “no
consumer may act on this” is in the artifact, not in a thread.

**Sign when presence starts *authorizing* something** — the first real case will be “don't start `dev-1575`
here; mini holds the vise” or “this shop has capacity, put a new room there”. Those are decisions, and a
decision from a hint needs a signature. At that point `did:key` signing of the doc is ~30 lines and each shop
already needs a key for the lease.

On the file-scoped exemption for `fleet.ts`: agreed, with one condition — the narrowing's reason names *what* it
is exempt from (“typing an untrusted network boundary; the fetcher is injected and every hostile shape is a
fixture”) and names the fixture that covers it. An exemption without a named test is a hole with prose.

**Open question:** is a `mismatch` an error entry (excluded from the fold) or shown with the discrepancy named?
My vote: shown, never silently excluded — but compare *normalized* labels first (`macbook` vs
`macbook.tail…ts.net`), because excluding a real shop over a naming difference hides a machine that is up.
