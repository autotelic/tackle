import { defineConfig } from "vite"

export default defineConfig({
  base: "/factory/",
  server: {
    port: 4782,
    // The room control plane is the same origin in production, so the dev server forwards the
    // whole prefix: the list, the create, and every lifecycle path under /rooms/.
    proxy: { "/presence": "http://127.0.0.1:4780", "/rooms": "http://127.0.0.1:4780" },
  },
  build: { outDir: "dist" },
})
