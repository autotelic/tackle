# UI variants

A two-tab toy for comparing implementations of the same small room inventory, with the
collision the isolation is supposed to remove.

- **Variant A** — a Web Component with shadow DOM and internal state.
- **Variant B** — a pure `render(state)` over direct DOM nodes, with event delegation.

Both variants intentionally use the same implementation facts:

- the same internal service port, `:4400`;
- the same `localStorage` key, `room-inventory`;
- the same room ids and service name.

They do **not** collide from outside because each runs in its own container network namespace:

```text
container A   web :4400  ->  host :4891
container B   web :4400  ->  host :4892
```

Each tab has its own origin, so the shared local-storage key is isolated by the browser too.

## Run with containers

```sh
docker compose up --build
open http://127.0.0.1:4891/
open http://127.0.0.1:4892/
```

Both containers listen on `:4400` inside. The only difference outside is the host port.

```sh
docker compose down
```

## Run without containers

The plain static version is still available if you only want to compare the two implementations:

```sh
python3 -m http.server 4890 --directory examples/ui-variants
open http://127.0.0.1:4890/variant-a.html
open http://127.0.0.1:4890/variant-b.html
```
