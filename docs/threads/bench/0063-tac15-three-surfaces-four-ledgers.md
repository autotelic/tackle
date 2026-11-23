# 0063 — TAC-15 — three surfaces, four ledgers, three answer types

The operator gave his actual model of how work happens, and it reorganised the surface docs. Summary, because it
changes two things in the build and nothing else.

**Three surfaces by role, not by product:**

| | machinery | funnel | strategy |
|---|---|---|---|
| where | herdr · rex · terminal | GitHub · Linear | Slack |
| latency | seconds | hours | days |
| the human is | inside the loop | at the boundary of the work | outside, thinking about direction |
| what they give | a thought injected into a live pass | a review comment, a ticket edit, a merge | a product question, a priority |

**Three answer types, and conflation is the failure:**

- **steer** — additive and unfenced. The lease holds the pen, so three steers at once is fine; being wrong is cheap
  and unrecorded. But a *decision-shaped* sentence in a live surface becomes an item, once.
- **state** — GitHub's. A PR is merged or it is not, and GitHub already has the permission model; we do not add a
  second one.
- **decision** — single-valued. An item with options and an expiry, first valid answer wins, later ones
  ‘supersedes’.

**Routing, one home per item:** a code question goes on the PR (the diff is there), an intent question on the ticket,
 a product question in the channel, a ten-second question live in the session. Cross-posting is two records and the
second answer is always wrong.

**Four ledgers, no mirroring:** GitHub = artifact, Linear = intent, workstream record = position, journal =
conversation. A digest is a rendering; a desk item is a question; neither is a copy.

**Two loops joined by a sha:** delivery (author → adopt → passes → PR → review → merge) and experience (deploy →
 traces/logs/queries → candidates → a ticket in the funnel), with ‘work.ship.sha’ as the join.

**The strategy surface is bidirectional**, which is the one genuinely new thing: product questions go out as items,
 and *declared* channels are read as context — producing **hints** that may shape a proposal and may never answer a
 decision or edit the SOW. Listening produces candidates; only a person produces decisions.

**For the build, two additions only:** a ‘route: "slack" | "github" | "live"’ on each desk item (declared when
raised), and the steer rule above. P0–P2 are otherwise unchanged; the desk item remains the only interface.

Docs rewritten: ‘docs/factory-loop.md’ (new, the spine), ‘docs/slack.md’ (now “the strategic surface”, with the
 listening half), ‘docs/surfaces.md’ (the three roles, plus herdr/rex as machinery), ‘docs/signals.md’ (the
 experience loop and the hint rule).

**Open question:** does ‘route’ belong on the desk item or on the workstream, with items inheriting? My vote: the
item — one workstream can need a code question on GitHub and a product question in Slack inside the same hour.
