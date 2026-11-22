/* oxlint-disable plumb/prefer-property-tests -- the fixture carries the three freshness values and the boundaries; generated dates would only restate the same arithmetic. */
import { describe, expect, it } from "vitest"
import {
  ageLabel,
  blockedByLabel,
  budgetLabel,
  checkpointLabel,
  closedFlags,
  observedLabel,
  sourceFreshnessLabel,
} from "../src/status.ts"
import { OBSERVED_AT, workstreams } from "./fixtures.ts"

const [perms, search, orphan] = workstreams
if (perms === undefined || search === undefined || orphan === undefined)
  throw new Error("fixtures are missing")

describe("ages", () => {
  it("renders a checkpoint age, never a bare sha or a zero", () => {
    expect(checkpointLabel({ checkpoint: perms.checkpoint, observedAt: OBSERVED_AT })).toBe(
      "checkpoint 9f1c2ab8 · 12m ago",
    )
    expect(
      checkpointLabel({
        checkpoint: { sha: "9f1c2ab8", at: OBSERVED_AT },
        observedAt: OBSERVED_AT,
      }),
    ).toBe("checkpoint 9f1c2ab8 · just now")
  })

  it("distinguishes no checkpoint from a checkpoint that just happened", () => {
    const missing = checkpointLabel({ checkpoint: null, observedAt: OBSERVED_AT })
    const justNow = checkpointLabel({
      checkpoint: { sha: "9f1c2ab8", at: OBSERVED_AT },
      observedAt: OBSERVED_AT,
    })
    expect(missing).toBe("no checkpoint yet")
    expect(justNow).not.toBe(missing)
    expect(missing).not.toMatch(/0m/u)
    expect(justNow).not.toMatch(/0m/u)
  })

  it("formats every age with its unit, including future clock skew", () => {
    const now = Date.parse(OBSERVED_AT)
    expect(ageLabel({ at: now - 59_000, now })).toBe("just now")
    expect(ageLabel({ at: now - 60_000, now })).toBe("1m ago")
    expect(ageLabel({ at: now - 3_600_000, now })).toBe("1h ago")
    expect(ageLabel({ at: now - 86_400_000, now })).toBe("1d ago")
    expect(ageLabel({ at: now + 1_000, now })).toBe("just now")
  })
})

describe("budget and blockers", () => {
  it("shows the pass count with its denominator", () => {
    expect(budgetLabel(perms.budget)).toBe("3/5 passes")
    expect(budgetLabel(undefined)).toBe("budget unknown")
  })

  it("shows a cap stop with its reason and counts, never as idle", () => {
    expect(budgetLabel(search.budget)).toBe("cap stop: passes 5/5")
  })

  it("names blockedBy ids, and keeps unknown distinct from empty", () => {
    expect(blockedByLabel(["integrations-1860", "docs-1902"])).toBe(
      "blocked by integrations-1860, docs-1902",
    )
    expect(blockedByLabel([])).toBe("not blocked by another workstream")
    expect(blockedByLabel(undefined)).toBe("blockedBy unknown")
  })
})

describe("freshness", () => {
  it("keeps all three values visible per source", () => {
    expect(sourceFreshnessLabel(perms)).toBe("github fresh · linear stale · reports unobserved")
    expect(sourceFreshnessLabel(orphan)).toBe("sources unknown")
  })

  it("ages the newest observation, and says never when nobody looked", () => {
    expect(observedLabel({ observed: perms.observed, observedAt: OBSERVED_AT })).toBe(
      "observed 1m ago",
    )
    expect(observedLabel({ observed: undefined, observedAt: OBSERVED_AT })).toBe(
      "observed: unknown",
    )
    expect(
      observedLabel({
        observed: { github: null, linear: null, reports: null },
        observedAt: OBSERVED_AT,
      }),
    ).toBe("observed: never")
  })
})

describe("the three closed flags", () => {
  it("keeps phase, PR and project separate and warns when phase done outruns GitHub", () => {
    const flags = closedFlags(perms)
    expect(flags.phase).toBe("done")
    expect(flags.pr).toBe("open")
    expect(flags.project).toBe("started")
    expect(flags.line).toBe("phase done · PR 1862 open · project started")
    expect(flags.warning).toContain("phase done · PR 1862 open — ready for a person, not finished")
    expect(flags.warning).toContain("phase done · project started — Linear still open")
  })

  it("warns when GitHub and Linear closed before the kernel did", () => {
    const flags = closedFlags(search)
    expect(flags.warning).toContain("PR 1877 merged · phase build — GitHub says landed")
    expect(flags.warning).toContain("project completed · phase build — Linear says finished")
  })

  it("says unknown rather than guessing a missing source flag", () => {
    const flags = closedFlags(orphan)
    expect(flags.line).toBe("phase open · no PR unknown · project unknown")
    expect(flags.warning).toBeNull()
    const doneWithoutSources = closedFlags({ ...orphan, phase: "done" })
    expect(doneWithoutSources.warning).toContain("phase done · no PR unknown")
    expect(doneWithoutSources.warning).toContain("phase done · project unknown")
  })
})
