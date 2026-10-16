import { describe, expect, test } from "vitest"
import { isEnabled, isIgnored, severityFor, unavailableFor, type JoggleConfig } from "../src/config.ts"

const config: JoggleConfig = {
  rules: {
    "joggle/duplicate-meaning": "off",
    "joggle/bundle-dot-notation": "error",
    "joggle/unaccounted-drop": { severity: "warn", onUnavailable: "propagate" },
  },
  ignore: [
    { rule: "joggle/bundle-*", path: "services/ui/app/routes/legacy/**", reason: "being deleted" },
    { path: "**/*.stories.tsx" },
  ],
}

describe("a repository's answers", () => {
  test("configure which rules run", () => {
    expect(isEnabled(config, "joggle/duplicate-meaning", "warn")).toBe(false)
    expect(isEnabled(config, "joggle/naming-drift", "warn")).toBe(true)
  })

  test("configure how loudly they speak", () => {
    expect(severityFor(config, "joggle/bundle-dot-notation", "warn")).toBe("error")
    // Unconfigured rules keep the severity they were written with.
    expect(severityFor(config, "joggle/naming-drift", "info")).toBe("info")
  })

  test("except a rule at a path", () => {
    expect(
      isIgnored({
        config,
        ruleId: "joggle/bundle-dot-notation",
        path: "services/ui/app/routes/legacy/components/index.ts",
      }),
    ).toBe(true)
    // The same rule elsewhere is not excepted.
    expect(isIgnored({ config, ruleId: "joggle/bundle-dot-notation", path: "services/ui/app/components/a/index.ts" })).toBe(false)
    // A rule outside the glob is not excepted, even at that path.
    expect(
      isIgnored({ config, ruleId: "joggle/duplicate-meaning", path: "services/ui/app/routes/legacy/a.ts" }),
    ).toBe(false)
  })

  test("except every rule at a path when no rule is named", () => {
    expect(isIgnored({ config, ruleId: "joggle/anything", path: "app/components/a.stories.tsx" })).toBe(true)
  })

  test("choose what a rule does when no judgement reaches it", () => {
    expect(unavailableFor(config, "joggle/unaccounted-drop", "report")).toBe("propagate")
    // A rule the config does not mention keeps its own declaration.
    expect(unavailableFor(config, "joggle/naming-drift", "report")).toBe("report")
    expect(unavailableFor({}, "joggle/naming-drift", "propagate")).toBe("propagate")
  })

  test("a run-wide answer for an unavailable model", () => {
    // The run's answer applies to a rule whose own setting is silent.
    expect(unavailableFor({ unavailable: "count" }, "joggle/naming-drift", "report")).toBe("count")
    // The rule's own answer wins over the run's.
    expect(unavailableFor(config, "joggle/unaccounted-drop", "report")).toBe("propagate")
    expect(
      unavailableFor({ ...config, unavailable: "count" }, "joggle/naming-drift", "report"),
    ).toBe("count")
  })

  test("an empty config changes nothing", () => {
    expect(severityFor({}, "joggle/duplicate-meaning", "warn")).toBe("warn")
    expect(isIgnored({ config: {}, ruleId: "joggle/duplicate-meaning", path: "src/a.ts" })).toBe(false)
  })
})
