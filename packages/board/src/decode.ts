import { Result, Schema } from "effect"
import { Chit, Claim, Job, Presence, Receipt } from "./records.ts"

/*
 * Readers.
 *
 * A room reads its own SQLite, a JSON file, or a webhook body; any of them may be stale,
 * hand-edited, or from one version earlier. `Schema` is the decoder and the issue is kept:
 * the caller decides whether absence is a skip or a finding, but it is never a half-object
 * that looks authoritative downstream.
 */

/**
 * Decode a chit.
 *
 * @param value - A row, a file object, or a boundary value that claims to be a chit.
 * @returns The chit, or the schema issue that refused it.
 */
export const decodeChit = (
  value: typeof Schema.JsonObject.Type,
): Result.Result<Chit, Schema.SchemaError> => Schema.decodeUnknownResult(Chit)(value)

/**
 * Decode a claim.
 *
 * @param value - A row, a file object, or a boundary value that claims to be a claim.
 * @returns The claim, or the schema issue that refused it.
 */
export const decodeClaim = (
  value: typeof Schema.JsonObject.Type,
): Result.Result<Claim, Schema.SchemaError> => Schema.decodeUnknownResult(Claim)(value)

/**
 * Decode a job.
 *
 * @param value - A row, a file object, or a boundary value that claims to be a job.
 * @returns The job, or the schema issue that refused it.
 */
export const decodeJob = (
  value: typeof Schema.JsonObject.Type,
): Result.Result<Job, Schema.SchemaError> => Schema.decodeUnknownResult(Job)(value)

/**
 * Decode a receipt.
 *
 * @param value - A row, a file object, or a boundary value that claims to be a receipt.
 * @returns The receipt, or the schema issue that refused it.
 */
export const decodeReceipt = (
  value: typeof Schema.JsonObject.Type,
): Result.Result<Receipt, Schema.SchemaError> => Schema.decodeUnknownResult(Receipt)(value)

/**
 * Decode a presence.
 *
 * @param value - A row, a file object, or a boundary value that claims to be a presence.
 * @returns The presence, or the schema issue that refused it.
 */
export const decodePresence = (
  value: typeof Schema.JsonObject.Type,
): Result.Result<Presence, Schema.SchemaError> => Schema.decodeUnknownResult(Presence)(value)
