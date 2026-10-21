import { Effect, FileSystem, Order, Path } from "effect"
import type { CatalogTokens, TokenSource } from "@autotelic/protocol"

/*
 * Pass 6 — tokens.
 *
 * Two layers, which currently disagree in the tree this was built against: a Tailwind
 * config can define `primary.500` (a brand purple) AND `primary.DEFAULT` (an HSL var),
 * while `:root` sets `--primary` to something else again. Both are "legal", and the
 * extractor must model both rather than pick one — surfacing that disagreement on day
 * one is the point of `tokens.md`.
 *
 * v0 reads keys with a brace-aware scan rather than evaluating the config module, so it
 * sees the shape of the theme without running it. That is honest for a first pass and is
 * the piece a `--check` and a fixture corpus will tighten.
 */

const CSS_VARIABLE = /--([a-zA-Z0-9-]+)\s*:/gu
const COLORISH =
  /(color|primary|secondary|accent|background|foreground|muted|border|input|ring|card|popover|destructive|success|warning|danger|info|brand)/u

/**
 * Which token bucket a CSS custom property belongs to, from its name alone.
 *
 * A Tailwind v3 tree keeps its palette in `:root` variables, not only in the config object:
 * `--font-display`, `--radius`, and the color vars all sit in the same block. Reading only
 * the config left `type`, `shape`, and `spacing` empty in a repo that obviously had them.
 */
export const cssVariableKind = (name: string): "color" | "type" | "shape" | "spacing" | "none" => {
  if (COLORISH.test(name)) return "color"
  if (/^(?:font|type)(?:-|$)/u.test(name)) return "type"
  if (/^(?:radius|shape)(?:-|$)/u.test(name) || name.includes("border-radius")) return "shape"
  if (/^(?:spacing|space|gap)(?:-|$)/u.test(name)) return "spacing"
  return "none"
}

/** The identifier keys at any depth inside the first `field: { … }` block. */
const keysInBlock = ({
  text,
  field,
}: {
  readonly text: string
  readonly field: string
}): ReadonlyArray<string> => {
  const index = text.indexOf(field)
  if (index < 0) return []
  const open = text.indexOf("{", index)
  if (open < 0) return []
  let depth = 0
  let end = text.length
  for (let cursor = open; cursor < text.length; cursor += 1) {
    const char = text[cursor]
    if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) {
        end = cursor
        break
      }
    }
  }
  const body = text.slice(open + 1, end)
  const keys = new Set<string>()
  const key = /["']?([A-Za-z_$][\w$-]*)["']?\s*:/gu
  let match: RegExpExecArray | null
  while ((match = key.exec(body)) !== null) {
    const name = match[1]
    if (name !== undefined) keys.add(name)
  }
  return [...keys]
}

/** The token vocabulary, from the configured Tailwind config and stylesheet. */
export const extractTokens = (
  root: string,
  source: TokenSource,
): Effect.Effect<CatalogTokens, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const colors = new Set<string>()

    const themeText = yield* Effect.orElseSucceed(
      fs.readFileString(path.resolve(root, source.from)),
      () => "",
    )
    for (const key of keysInBlock({ text: themeText, field: "colors" })) colors.add(key)
    const type = new Set(keysInBlock({ text: themeText, field: "fontSize" }))
    const shape = new Set(keysInBlock({ text: themeText, field: "borderRadius" }))
    const spacing = new Set(keysInBlock({ text: themeText, field: "spacing" }))

    if (source.vars !== undefined) {
      const css = yield* Effect.orElseSucceed(
        fs.readFileString(path.resolve(root, source.vars)),
        () => "",
      )
      let match: RegExpExecArray | null
      CSS_VARIABLE.lastIndex = 0
      while ((match = CSS_VARIABLE.exec(css)) !== null) {
        const name = match[1]
        if (name === undefined) continue
        const kind = cssVariableKind(name)
        if (kind === "color") colors.add(name)
        else if (kind === "type") type.add(name)
        else if (kind === "shape") shape.add(name)
        else if (kind === "spacing") spacing.add(name)
      }
    }

    return {
      colors: [...colors].sort(Order.String),
      type: [...type].sort(Order.String),
      shape: [...shape].sort(Order.String),
      spacing: [...spacing].sort(Order.String),
    }
  })
