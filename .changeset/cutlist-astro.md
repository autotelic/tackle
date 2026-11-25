---
"@autotelic/cutlist": minor
---

Read `.astro` files. An Astro component is parsed as the TSX module its frontmatter and template make together, so imports, rendered tags (with their original line numbers), the default export and `interface Props` land in the catalog like any other component. `.astro` imports resolve into the use-graph, and every `.astro` page under the route directory is a route entry (underscore-prefixed paths excluded, as Astro does).
