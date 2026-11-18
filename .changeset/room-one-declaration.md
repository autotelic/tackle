---
"@autotelic/room": patch
---

One `hcOf`, one `InboxItem`.

The command surface and the review runner each carried their own way to find herdr-core (PATH,
then `~/.local/bin`), and the HTTP client redeclared the ledger's inbox row field for field.
`hcOf` lives in `shell.ts` now -- the one place the room touches a CLI -- and answers a
`Result` with the reason, like `onPath` beside it, instead of an `Option` that hides why the
binary was not found.
