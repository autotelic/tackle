# Issue trackers are pluggable: GitHub or markdown files

ADR-0001's principle is "the tracker and git are the Loop's state, not a machine
snapshot"; it pinned the tracker to GitHub. The Shakti H2 permissions work wants
issues as markdown files in a vault working directory (a nested git repo): the
SOW directory is already the engagement's source of truth, Ed steers by editing
files, and the laptop that holds the vault is often offline — a GitHub-free
tracker keeps the Loop's whole state in local git, syncable when the machines
can see each other.

The tracker surface the Loop touches is small (list ready/working, relabel,
comment, read labels, receipts, issue URL), so `src/loop/tracker.ts` dispatches
on `issues.tracker` in the target repo's `loop.config.ts`: `github` (default,
unchanged) or `markdown` (`issues.dir`; see docs/markdown-issues.md). GitHub's
shapes stay the common vocabulary: markdown `state:` values are labels,
`blocked_by:` references resolve to open/closed nodes, receipts round-trip
through timestamped log files exactly as they did through issue comments.

## Considered options

- **Keep GitHub, mirror to markdown.** Two sources of truth with a sync between
  them — the very thing ADR-0001 rejected.
- **A Tracker object threaded through the machine's deps.** Cleaner OO, but it
  touches every dep and test for no behavioural gain; config-dispatched module
  functions match the codebase's existing style.

## Consequences

- File ownership is the offline-merging contract: humans own the issue files,
  the Loop owns `log/` and the `state:` frontmatter line. Disjoint by
  convention, so the Loop's pull (ff-only, rebase fallback) applies cleanly
  even after both sides wrote while the laptop was away.
- A markdown issue with no `state:` is invisible to the queues, so drafts can
  live in the same directory. A stateless issue still blocks its dependents —
  the same shape as GitHub's label-less open issue after the PR opens.
  `state: done` is the human's "merged" signal that unblocks them.
- Stacked PRs work on both trackers: `base:` frontmatter or a `Base:` body
  line. A numeric base gates picking on the base issue's `loop/<n>` branch
  existing; PRs open against the resolved base, and the default base is the
  repo's own default branch, no longer hard-coded `main`.
- `run-issue.ts` (the one-shot script) stays GitHub-only; `run-loop.ts` is the
  supported entry point.
- Receipts and labels can still be written by anything that can write the
  tracker repo, including the agent — the same guardrail caveat ADR-0001
  recorded for GitHub.
