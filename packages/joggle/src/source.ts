import type { Predicate } from "effect"

/**
 * What counts as source.
 *
 * This used to be TypeScript only, and it was never a decision: the extension
 * list arrived with the first rebuild and nobody revisited it. On one real
 * repository that meant 1,457 JavaScript files -- an entire API and an entire
 * admin UI -- were never read, while the report said "287 files" with no hint
 * that four fifths of the tree was missing. A partial analysis that looks
 * complete is the worst output this program can produce.
 *
 * Both discovery paths ask this -- the directory walk and the compiler's file
 * list -- so a run with paths and a run without cannot disagree about what is
 * source.
 *
 * Declarations stay out: a `.d.ts` describes a build's output rather than a
 * source file, and analysing one reports on code nobody wrote. `.astro` files
 * count: their frontmatter and scripts are TypeScript, read through `astro.ts`.
 *
 * A content mapper's declaration output has a second shape: `App.d.svelte.ts`
 * for `App.svelte`, `Page.d.vue.ts` for `Page.vue`. It ends in `.ts`, so the
 * `.d.ts` check above misses it, and analysing it reports the mapper's
 * scaffolding as if an author had written it.
 */
export const looksLikeSource: Predicate.Predicate<string> = (file) => {
  if (file.endsWith(".d.ts") || file.endsWith(".d.mts") || file.endsWith(".d.cts")) return false
  if (/\.d\.[a-z0-9]+\.ts$/iu.test(file)) return false
  return /\.(?:[cm]?[jt]sx?|astro)$/.test(file)
}
