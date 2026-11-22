# Progress — issue #3: sessions

## Works

- The board's `/presence` sessions now carry the evidence the view renders: `cwd`,
  `state`, `status`, `where` (Rex's session label), `workstream`, and `joinedBy`
  (`label`, `factory`, `cwd`, or `title`). The served document keeps `cwd` and drops
  only the raw label map.
- A session with no cwd/workstream still appears under `unjoined` on the factory view.
- Each session row shows the Herdr address or Rex label, agent, cwd, state, the
  source's verbatim status beside our normalized `live` / `idle` / `blocked` badge
  (`done` renders as `idle` but the word `done` stays visible), and how it joined.
- The action is a copyable command, not an exec endpoint: `hc attach <address>` for
  Herdr and `rex block focus -s <label>` for Rex. `Copy` uses the clipboard command
  and shows the exact same string in a `<code>` block.
- `POST /open` is gone from the board. A POST now gets 405; the view's only network
  read is `GET /presence`.

## Tests

- `packages/board/test/sessions.test.ts` covers join evidence (`cwd`, `label`,
  `title`), longest-worktree matching, the unjoined case, and the wire shape.
- `packages/board/test/cli.test.ts` asserts `POST /open` is refused with 405.
- `packages/factory-view/test/sessions.test.ts` covers both exact commands and all
  status normalizations, including `done → idle` with the verbatim word kept.
- `packages/factory-view/test/view.test.ts` renders the real Foldkit view: session
  fields, badges, command text, the `unjoined` section, both clipboard actions, and
  a source guard that no `POST` or `/open` remains.

## Next

- Rebase over the workstream-panel branch when it lands; sessions are intentionally
  rendered by the same row helper, so that merge should be a small adaptation.
