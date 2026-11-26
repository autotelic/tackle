import { mkdir, readFile, rename, chmod, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Predicate as P } from "effect"
import * as Schema from "effect/Schema"
import * as Result from "effect/Result"
import { factoryHome } from "./store.ts"

/** The kinds of accounts a repository can declare. Kind is a hint for the setup card, not authority. */
export const CredentialKind = Schema.Literals(["github", "opencode", "mcp", "service", "generic"])
export type CredentialKind = typeof CredentialKind.Type

/**
 * One stored account. `env` is the mapping the executor hands to a worker or VM: the key is
 * the variable the tool reads, the value is the secret. Secrets never appear in a summary.
 */
export const StoredCredential = Schema.Struct({
  id: Schema.String,
  kind: CredentialKind,
  description: Schema.optional(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
  at: Schema.String,
})
export type StoredCredential = typeof StoredCredential.Type

const CredentialFile = Schema.Struct({
  version: Schema.Literal(1),
  credentials: Schema.Record(Schema.String, StoredCredential),
})
type CredentialFile = typeof CredentialFile.Type

const GrantsFile = Schema.Struct({
  version: Schema.Literal(1),
  grants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
})
type GrantsFile = typeof GrantsFile.Type

/** One row a repository promises the executor will be able to satisfy. */
export const CredentialRequirement = Schema.Struct({
  id: Schema.String,
  kind: CredentialKind,
  env: Schema.Array(Schema.String),
  reason: Schema.String,
  required: Schema.optional(Schema.Boolean),
})
export type CredentialRequirement = typeof CredentialRequirement.Type

export const RepositoryCredentials = Schema.Struct({
  version: Schema.Literal(1),
  credentials: Schema.Array(CredentialRequirement),
})
export type RepositoryCredentials = typeof RepositoryCredentials.Type

/** A short-lived view of the variables one workstream may receive. */
export const ExecutorLease = Schema.Struct({
  version: Schema.Literal(1),
  workstream: Schema.String,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  credentials: Schema.Array(Schema.Struct({ id: Schema.String, kind: CredentialKind })),
  env: Schema.Record(Schema.String, Schema.String),
})
export type ExecutorLease = typeof ExecutorLease.Type

export class ExecutorError extends Error {
  readonly _tag:
    | "ExecutorError"
    | "ExecutorDecodeError"
    | "CredentialMissing"
    | "CredentialConflict"
  constructor(tag: ExecutorError["_tag"], message: string) {
    super(message)
    this._tag = tag
  }
}

/** The executor store directory under the factory home. */
export const executorDir = (home: string = factoryHome()): string => join(home, "executor")

/** The 0600 file holding account values. */
export const credentialsFile = (home: string = factoryHome()): string =>
  join(executorDir(home), "credentials.json")

/** The file mapping workstreams to the account ids they may receive. */
export const grantsFile = (home: string = factoryHome()): string =>
  join(executorDir(home), "grants.json")

/** The directory of short-lived leases handed to VMs. */
export const leasesDir = (home: string = factoryHome()): string => join(executorDir(home), "leases")

/** The committed declaration of accounts a repository expects. */
export const repositoryCredentialsFile = (repo: string): string =>
  join(repo, ".factory", "credentials.json")

const emptyCredentials: CredentialFile = { version: 1, credentials: {} }
const emptyGrants: GrantsFile = { version: 1, grants: {} }

/** Read a JSON file, treating absence as empty; a malformed file is never an empty secret store. */
const readText = async (path: string): Promise<string | undefined> =>
  readFile(path, "utf8").catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined
    throw cause
  })

const writeJson = async (
  path: string,
  value: CredentialFile | GrantsFile | ExecutorLease,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // One writer per factory process; the pid names the scratch file without a clock or counter.
  const temporary = path + ".tmp-" + process.pid
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

/** Read the account store; a malformed file is loud, never an empty secret store. */
export const readCredentials = async (home: string = factoryHome()): Promise<CredentialFile> => {
  const path = credentialsFile(home)
  const text = await readText(path)
  if (text === undefined) return emptyCredentials
  const decoded = Schema.decodeResult(Schema.fromJsonString(CredentialFile))(text)
  if (Result.isFailure(decoded))
    throw new ExecutorError(
      "ExecutorDecodeError",
      path + " does not decode: " + String(decoded.failure),
    )
  return decoded.success
}

/** Read the workstream grant map; absence is an empty map. */
export const readGrants = async (home: string = factoryHome()): Promise<GrantsFile> => {
  const path = grantsFile(home)
  const text = await readText(path)
  if (text === undefined) return emptyGrants
  const decoded = Schema.decodeResult(Schema.fromJsonString(GrantsFile))(text)
  if (Result.isFailure(decoded))
    throw new ExecutorError(
      "ExecutorDecodeError",
      path + " does not decode: " + String(decoded.failure),
    )
  return decoded.success
}

export interface CredentialSummary {
  readonly id: string
  readonly kind: CredentialKind
  readonly description?: string
  readonly env: ReadonlyArray<string>
  readonly at: string
}

const summaryOf = (credential: StoredCredential): CredentialSummary => {
  const summary = {
    id: credential.id,
    kind: credential.kind,
    env: Object.keys(credential.env).sort((a, b) => a.localeCompare(b)),
    at: credential.at,
  }
  return credential.description === undefined
    ? summary
    : { ...summary, description: credential.description }
}

/** Store or replace one account. This is the only function that writes a secret value. */
export const setCredential = async (input: {
  readonly home?: string | undefined
  readonly id: string
  readonly kind: CredentialKind
  readonly description?: string | undefined
  readonly env: Record<string, string>
  readonly at: string
}): Promise<CredentialSummary> => {
  if (Object.keys(input.env).length === 0)
    throw new ExecutorError(
      "ExecutorError",
      "credential " + input.id + " has no environment variables",
    )
  const file = await readCredentials(input.home)
  const base = {
    id: input.id,
    kind: input.kind,
    env: { ...input.env },
    at: input.at,
  }
  const credential: StoredCredential =
    input.description === undefined ? base : { ...base, description: input.description }
  await writeJson(credentialsFile(input.home), {
    version: 1,
    credentials: { ...file.credentials, [input.id]: credential },
  })
  return summaryOf(credential)
}

/** Remove one account and every grant that named it. */
export const removeCredential = async (input: {
  readonly home?: string | undefined
  readonly id: string
}): Promise<boolean> => {
  const file = await readCredentials(input.home)
  if (file.credentials[input.id] === undefined) return false
  const { [input.id]: _removed, ...rest } = file.credentials
  await writeJson(credentialsFile(input.home), { version: 1, credentials: rest })
  const grants = await readGrants(input.home)
  const next = Object.fromEntries(
    Object.entries(grants.grants).map(([workstream, ids]) => [
      workstream,
      ids.filter((id) => id !== input.id),
    ]),
  )
  await writeJson(grantsFile(input.home), { version: 1, grants: next })
  return true
}

/** List accounts by name and variable, never by value. */
export const listCredentials = async (home?: string): Promise<ReadonlyArray<CredentialSummary>> => {
  const file = await readCredentials(home)
  return Object.values(file.credentials)
    .map(summaryOf)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Replace a workstream grant list after checking every named account exists. */
export const setGrants = async (input: {
  readonly home?: string | undefined
  readonly workstream: string
  readonly credentials: ReadonlyArray<string>
}): Promise<ReadonlyArray<string>> => {
  const file = await readCredentials(input.home)
  const unknown = input.credentials.filter((id) => file.credentials[id] === undefined)
  if (unknown.length > 0)
    throw new ExecutorError(
      "CredentialMissing",
      "no stored credential for " + unknown.join(", ") + "; configure it before granting it",
    )
  const ids = [...new Set(input.credentials)].sort((a, b) => a.localeCompare(b))
  const grants = await readGrants(input.home)
  await writeJson(grantsFile(input.home), {
    version: 1,
    grants: { ...grants.grants, [input.workstream]: ids },
  })
  return ids
}

/** The account ids one workstream may receive. */
export const grantsFor = async (input: {
  readonly home?: string | undefined
  readonly workstream: string
}): Promise<ReadonlyArray<string>> => {
  const grants = await readGrants(input.home)
  return grants.grants[input.workstream] ?? []
}

export interface ResolvedCredentials {
  readonly credentials: ReadonlyArray<{ readonly id: string; readonly kind: CredentialKind }>
  readonly env: Record<string, string>
}

/**
 * Resolve only the accounts granted to this workstream. Two credentials that name the same
 * environment variable with different values are a configuration error: silently picking one
 * would make the worker's authority depend on object order.
 */
export const resolveCredentialEnv = async (input: {
  readonly home?: string | undefined
  readonly workstream: string
}): Promise<ResolvedCredentials> => {
  const file = await readCredentials(input.home)
  const ids = await grantsFor(input)
  const env: Record<string, string> = {}
  const owners: Record<string, string> = {}
  const credentials: Array<{ id: string; kind: CredentialKind }> = []
  for (const id of ids) {
    const credential = file.credentials[id]
    if (credential === undefined)
      throw new ExecutorError("CredentialMissing", "grant names an unconfigured credential: " + id)
    credentials.push({ id, kind: credential.kind })
    for (const [name, value] of Object.entries(credential.env)) {
      const owner = owners[name]
      if (owner !== undefined && env[name] !== value)
        throw new ExecutorError(
          "CredentialConflict",
          "credentials " + owner + " and " + id + " both set " + name,
        )
      owners[name] = id
      env[name] = value
    }
  }
  return { credentials, env }
}

/** Mint a lease for one workstream. The lease is the only object a VM needs to learn its env. */
export const leaseFor = async (input: {
  readonly home?: string | undefined
  readonly workstream: string
  readonly ttlMs: number
  readonly at: number
}): Promise<ExecutorLease> => {
  const resolved = await resolveCredentialEnv(input)
  return {
    version: 1,
    workstream: input.workstream,
    issuedAt: new Date(input.at).toISOString(),
    expiresAt: new Date(input.at + input.ttlMs).toISOString(),
    credentials: resolved.credentials,
    env: resolved.env,
  }
}

/** Write a lease to a 0600 file; the path is returned for the room command. */
export const writeLease = async (input: {
  readonly home?: string | undefined
  readonly lease: ExecutorLease
  readonly out?: string | undefined
}): Promise<string> => {
  const path = input.out ?? join(leasesDir(input.home), input.lease.workstream + ".json")
  await writeJson(path, input.lease)
  return path
}

/** Read the repository-owned declaration of what accounts this repo expects. */
export const readRepositoryCredentials = async (repo: string): Promise<RepositoryCredentials> => {
  const path = repositoryCredentialsFile(repo)
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined
    throw cause
  })
  if (text === undefined) return { version: 1, credentials: [] }
  const decoded = Schema.decodeResult(Schema.fromJsonString(RepositoryCredentials))(text)
  if (Result.isFailure(decoded))
    throw new ExecutorError(
      "ExecutorDecodeError",
      path + " does not decode: " + String(decoded.failure),
    )
  return decoded.success
}

export interface CredentialCheck {
  readonly id: string
  readonly kind: CredentialKind
  readonly env: ReadonlyArray<string>
  readonly reason: string
  readonly required: boolean
  readonly present: boolean
  readonly missingEnv: ReadonlyArray<string>
}

/** The setup card: what this repo asks for, and which pieces the executor cannot satisfy. */
export const checkRepositoryCredentials = async (input: {
  readonly home?: string | undefined
  readonly repo: string
}): Promise<ReadonlyArray<CredentialCheck>> => {
  const manifest = await readRepositoryCredentials(input.repo)
  const file = await readCredentials(input.home)
  return manifest.credentials.map((requirement) => {
    const credential = file.credentials[requirement.id]
    const missingEnv = requirement.env.filter(
      (name) => credential === undefined || credential.env[name] === undefined,
    )
    return {
      id: requirement.id,
      kind: requirement.kind,
      env: requirement.env,
      reason: requirement.reason,
      required: requirement.required !== false,
      present: credential !== undefined && missingEnv.length === 0,
      missingEnv,
    }
  })
}

/**
 * Make the repository manifest the grant list for one workstream. A repo with no manifest is
 * left in the host-environment mode; a repo with one gets exactly what it declared.
 */
export const prepareWorkstreamCredentials = async (input: {
  readonly home?: string | undefined
  readonly repo: string
  readonly workstream: string
}): Promise<{ readonly managed: boolean; readonly checks: ReadonlyArray<CredentialCheck> }> => {
  const checks = await checkRepositoryCredentials(input)
  if (checks.length === 0) return { managed: false, checks }
  const missing = checks.filter((check) => check.required && !check.present)
  if (missing.length > 0)
    throw new ExecutorError(
      "CredentialMissing",
      "repo " +
        input.repo +
        " requires " +
        missing.map((check) => check.id + " (" + check.env.join(", ") + ")").join(", ") +
        "; configure them with factory credentials set",
    )
  await setGrants({
    home: input.home,
    workstream: input.workstream,
    credentials: checks.filter((check) => check.present).map((check) => check.id),
  })
  return { managed: true, checks }
}

const SECRET_ENV =
  /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY_ID|CREDENTIALS?|AUTH|DATABASE_URL|REDIS_URL|MONGODB_URI|CONNECTION_STRING)/iu
const TRANSPORT_ENV = new Set(["SSH_AUTH_SOCK", "SSH_AGENT_PID"])

/** Whether the host environment name looks like a secret the executor should mediate. */
export const isSecretEnvName: P.Predicate<string> = (name) =>
  !TRANSPORT_ENV.has(name) && SECRET_ENV.test(name)

/**
 * The host environment a factory worker may inherit directly: paths, locale, home, and the
 * harness's own controls, never an unmanaged token. Only a repo manifest opts into the broker.
 */
export const baseWorkerEnv = (source: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !isSecretEnvName(entry[0]),
    ),
  )
