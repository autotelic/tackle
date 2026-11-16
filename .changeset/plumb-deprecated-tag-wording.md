---
"@autotelic/plumb": patch
---

`require-deprecated-tag-for-legacy-comments` says the tag must be inside the comment that names
the retirement. A tag in the neighbouring block does not satisfy the rule, and the old message
("add `@deprecated`") read as if it did — the natural fix failed silently.
