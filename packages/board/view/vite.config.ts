import { defineConfig } from "vite"

export default defineConfig({
  base: "/factory/",
  server: {
    port: 4782,
    proxy: { "/presence": "http://127.0.0.1:4780" },
  },
  build: { outDir: "dist" },
})
