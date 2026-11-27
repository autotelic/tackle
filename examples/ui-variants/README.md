# UI variants

A two-tab toy for comparing implementations of the same small room inventory.

- **Variant A** — a Web Component with shadow DOM and internal state.
- **Variant B** — a pure `render(state)` over direct DOM nodes, with event delegation.

Both start from the same `seed` in `data.js`; each tab owns its state, so the buttons are local.

## Run

```sh
python3 -m http.server 4890 --directory examples/ui-variants
open http://127.0.0.1:4890/
```

Open `variant-a.html` and `variant-b.html` in two tabs side by side.
