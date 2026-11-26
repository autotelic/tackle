import * as Schema from "effect/Schema"
import * as Result from "effect/Result"
import { readFile } from "node:fs/promises"

/** The shape the factory's executor writes for one workstream. It carries no secret metadata. */
export const ExecutorLease = Schema.Struct({
  version: Schema.Literal(1),
  workstream: Schema.String,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  credentials: Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.String })),
  env: Schema.Record(Schema.String, Schema.String),
})
export type ExecutorLease = typeof ExecutorLease.Type

export class ExecutorLeaseError extends Error {
  readonly _tag: "ExecutorLeaseError" | "ExecutorLeaseExpired"
  constructor(tag: ExecutorLeaseError["_tag"], message: string) {
    super(message)
    this._tag = tag
  }
}

/**
 * Read a lease the executor minted. A missing or malformed lease is a refusal, not an empty
 * environment: starting without the credentials the caller asked for is the failure this file
 * exists to prevent. Expiry is checked against the caller's clock, so no clock runs here.
 */
export const readExecutorLease = async (path: string, at: number): Promise<ExecutorLease> => {
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      throw new ExecutorLeaseError("ExecutorLeaseError", "lease not found: " + path)
    throw cause
  })
  const decoded = Schema.decodeResult(Schema.fromJsonString(ExecutorLease))(text)
  if (Result.isFailure(decoded))
    throw new ExecutorLeaseError(
      "ExecutorLeaseError",
      "lease does not decode: " + path + ": " + String(decoded.failure),
    )
  if (Date.parse(decoded.success.expiresAt) <= at)
    throw new ExecutorLeaseError(
      "ExecutorLeaseExpired",
      "lease expired at " + decoded.success.expiresAt + ": " + path,
    )
  return decoded.success
}
