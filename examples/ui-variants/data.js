/** The same seed both variants render. Each tab keeps its own copy. */
export const seed = [
  {
    id: "alpha",
    state: "Ready",
    runtime: "agentos",
    vm: { state: "running", pid: 9001 },
    process: { pid: 4242, alive: true, exec: "pnpm dev" },
  },
  {
    id: "beta",
    state: "Paused",
    process: null,
  },
]
