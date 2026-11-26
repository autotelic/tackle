/* oxlint-disable plumb/prefer-property-tests -- credential fixtures are one store, one manifest, one lease; the assertion is the refusal. */
import { expect, test } from "vitest"
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  baseWorkerEnv,
  checkRepositoryCredentials,
  isSecretEnvName,
  leaseFor,
  listCredentials,
  prepareWorkstreamCredentials,
  readRepositoryCredentials,
  resolveCredentialEnv,
  setCredential,
  setGrants,
  writeLease,
} from "../src/factory/executor.ts"

const at = "2026-11-26T00:00:00.000Z"

const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-"))
  return { root, home: join(root, "home"), repo: join(root, "repo") }
}

const manifest = async (repo: string) => {
  await mkdir(join(repo, ".factory"), { recursive: true })
  await writeFile(
    join(repo, ".factory", "credentials.json"),
    JSON.stringify({
      version: 1,
      mode: "enforce",
      credentials: [
        {
          id: "github",
          kind: "github",
          env: ["GH_TOKEN"],
          reason: "read pull requests",
        },
        {
          id: "opencode",
          kind: "opencode",
          env: ["OPENCODE_API_KEY"],
          reason: "run the worker model",
        },
      ],
    }),
  )
}

test("a credential summary names its variables and never its secrets", async () => {
  const { home } = await scratch()
  try {
    await setCredential({
      home,
      id: "github",
      kind: "github",
      env: { GH_TOKEN: "ghp_secret" },
      at,
    })
    const listed = await listCredentials(home)
    expect(listed).toEqual([{ id: "github", kind: "github", env: ["GH_TOKEN"], at }])
    expect(JSON.stringify(listed)).not.toContain("ghp_secret")
    const mode = (await stat(join(home, "executor", "credentials.json"))).mode & 0o777
    expect(mode).toBe(0o600)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a repo manifest is the grant list, and a missing account refuses the pass", async () => {
  const { home, repo } = await scratch()
  try {
    await manifest(repo)
    const missing = await checkRepositoryCredentials({ home, repo })
    expect(missing.map((check) => [check.id, check.present])).toEqual([
      ["github", false],
      ["opencode", false],
    ])
    await expect(prepareWorkstreamCredentials({ home, repo, workstream: "work" })).rejects.toThrow(
      /requires github \(GH_TOKEN\), opencode \(OPENCODE_API_KEY\)/,
    )

    await setCredential({
      home,
      id: "github",
      kind: "github",
      env: { GH_TOKEN: "ghp_secret" },
      at,
    })
    await setCredential({
      home,
      id: "opencode",
      kind: "opencode",
      env: { OPENCODE_API_KEY: "oc_secret" },
      at,
    })
    const prepared = await prepareWorkstreamCredentials({ home, repo, workstream: "work" })
    expect(prepared.managed).toBe(true)
    expect(prepared.mode).toBe("enforce")
    const resolved = await resolveCredentialEnv({ home, workstream: "work" })
    expect(resolved.env).toEqual({ GH_TOKEN: "ghp_secret", OPENCODE_API_KEY: "oc_secret" })
    expect(resolved.credentials.map((credential) => credential.id)).toEqual(["github", "opencode"])
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test("a manual grant cannot smuggle an unconfigured credential", async () => {
  const { home } = await scratch()
  try {
    await expect(setGrants({ home, workstream: "work", credentials: ["missing"] })).rejects.toThrow(
      /no stored credential for missing/,
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a lease carries only granted env, and is written 0600", async () => {
  const { home, repo } = await scratch()
  try {
    await manifest(repo)
    await setCredential({
      home,
      id: "github",
      kind: "github",
      env: { GH_TOKEN: "ghp_secret" },
      at,
    })
    await setCredential({
      home,
      id: "opencode",
      kind: "opencode",
      env: { OPENCODE_API_KEY: "oc_secret" },
      at,
    })
    await prepareWorkstreamCredentials({ home, repo, workstream: "work" })
    const lease = await leaseFor({ home, workstream: "work", ttlMs: 60_000, at: Date.now() })
    expect(lease.env).toEqual({ GH_TOKEN: "ghp_secret", OPENCODE_API_KEY: "oc_secret" })
    const path = await writeLease({ home, lease, out: join(home, "lease.json") })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test("a repository with no manifest is legacy, not an empty grant list", async () => {
  const { home, repo } = await scratch()
  try {
    const manifest = await readRepositoryCredentials(repo)
    expect(manifest.credentials).toEqual([])
    const prepared = await prepareWorkstreamCredentials({ home, repo, workstream: "work" })
    expect(prepared.managed).toBe(false)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test("a manifest without mode is advisory and does not refuse the pass", async () => {
  const { home, repo } = await scratch()
  try {
    await mkdir(join(repo, ".factory"), { recursive: true })
    await writeFile(
      join(repo, ".factory", "credentials.json"),
      JSON.stringify({
        version: 1,
        credentials: [
          { id: "github", kind: "github", env: ["GH_TOKEN"], reason: "read pull requests" },
        ],
      }),
    )
    const prepared = await prepareWorkstreamCredentials({ home, repo, workstream: "work" })
    expect(prepared.mode).toBe("advisory")
    expect(prepared.managed).toBe(false)
    expect(prepared.checks[0]?.present).toBe(false)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test("the worker base env strips secret names but keeps the transport and paths", () => {
  const env = baseWorkerEnv({
    PATH: "/bin",
    HOME: "/home/agent",
    GH_TOKEN: "secret",
    OPENCODE_API_KEY: "secret",
    DATABASE_URL: "postgres://secret",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    GITHUB_ACTIONS: "true",
  })
  expect(env).toEqual({
    PATH: "/bin",
    HOME: "/home/agent",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    GITHUB_ACTIONS: "true",
  })
  expect(isSecretEnvName("GH_TOKEN")).toBe(true)
  expect(isSecretEnvName("PATH")).toBe(false)
})
