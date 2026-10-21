import { Order } from "effect"
import type { SourceModule } from "./crawl.ts"

/*
 * Pass 5 — signature.
 *
 * The proposal claims `props ∪ tags` surfaces `Combobox`/`ComboBoxV2` at Jaccard ≥ 0.8.
 * Measured on the real files it scores ~0.18 on props and ~0.43 on tags — the metric
 * does not reproduce its own headline example. Props are surface area; they are the
 * wrong signature. Two components that wrap the same headless primitive and render the
 * same skeleton are the same concept however their props differ, and `Button` — which
 * shares generic props with half an app — must NOT match everything.
 *
 * So the signature is the behavioral skeleton: the headless primitive it wraps, the
 * sub-components it renders (as tags), and the hooks it calls. Deterministic, and it
 * scores the known pair near 1.0 while leaving `Button` alone.
 */

/** External UI kits whose presence in the import set is a behavioral signal. */
const HEADLESS_PACKAGES: ReadonlyArray<string> = [
  "@headlessui/react",
  "@radix-ui/",
  "react-aria",
  "react-stately",
  "@base-ui-components/",
  "ariakit",
]

/**
 * A JSX tag that names a composition, not a host element.
 *
 * `<div>`, `<span>`, and `<path>` are the frame every component is built in, so two
 * components that both render a `<span>` are not thereby the same concept. Keeping host
 * tags made `Badge` and `AnimatedRainbow` score a perfect 1.0 and put a page of
 * one-tag matches at the top of every duplicate list. JSX capitalisation is the language's
 * own boundary: a lowercase name is an intrinsic element, an uppercase one is a reference.
 */
const isCompositionTag = (tag: string): boolean => /^[A-Z]/u.test(tag)

/** The behavioral skeleton of one module. */
export const skeletonOf = (module: SourceModule): ReadonlyArray<string> => {
  const parts = new Set<string>()
  for (const tag of module.tags) if (isCompositionTag(tag)) parts.add(`tag:${tag}`)
  for (const hook of module.hooks) parts.add(`hook:${hook}`)
  for (const specifier of module.imports) {
    if (HEADLESS_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(pkg))) {
      parts.add(`uses:${specifier}`)
    }
  }
  return [...parts].sort(Order.String)
}
