import { Schema } from "effect"
import * as Result from "effect/Result"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

/*
 * One room's root-filesystem snapshot: the bytes `vm.filesystem.export` returns, kept whole
 * beside the room record, and the one fact that makes pause mean something. A paused room whose
 * only durable state was the VM's sqlite could not say what its disk was; a room with a snapshot
 * and a hash can.
 */

/**
 * `filesystem.export`'s answer, restated because the pin exports `createSnapshotExport` and not
 * the type.
 *
 * The value is kept whole — never decoded into this shape and written back — because a decoder
 * that names fewer fields than the runtime emits would drop a file's `content` and leave a
 * snapshot that restores directories with nothing in them.
 */
export interface VmSnapshotEntry {
  readonly path: string
  readonly type: "directory" | "file" | "symlink"
  readonly mode: string
  readonly uid: number
  readonly gid: number
  readonly content?: string
  readonly encoding?: "utf8" | "base64"
  readonly target?: string
}

export interface VmSnapshotExport {
  readonly kind: "snapshot-export"
  readonly source: {
    readonly format: "agentos-filesystem-snapshot-v1"
    readonly filesystem: { readonly entries: VmSnapshotEntry[] }
  }
}

/**
 * The bound one room's snapshot may reach, in bytes.
 *
 * It is deliberately generous for a guest root a room writes itself and far below the size of a
 * root that carries the software bundle. An export past it is reported as it is, never truncated
 * into a snapshot that would silently restore a partial disk.
 */
export const snapshotMaxBytes = 64 * 1024 * 1024

/**
 * Where a generation of a room's snapshot lives: beside `room.json`, never inside the worktree.
 *
 * The generation is part of the name so a resume never overwrites the file the resumed VM was
 * built from: a second pause writes its own snapshot instead of rewriting the first.
 */
export const snapshotFile = (input: {
  readonly stateDir: string
  readonly generation: number
}): string => join(input.stateDir, "vm-snapshot-" + input.generation + ".json")

/** The guest's projection of the host checkout; a snapshot that carries it cannot be restored. */
const workspacePrefix = "/workspace/"

/**
 * Refuse a snapshot that baked in the room's host mount.
 *
 * The mount is the worktree, and a resume mounts it again: a snapshot that carried its files
 * would restore a second copy of the checkout into a room that already projects one, and the
 * two would diverge with no record of which was real. `/workspace` itself is allowed — the root
 * filesystem keeps that empty directory under the mount — so the guard looks at what the mount
 * put *inside* it, not at the mount point.
 */
export const snapshotGuard = (exported: {
  readonly source: { readonly filesystem: { readonly entries: ReadonlyArray<{ path: string }> } }
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } => {
  const carried = exported.source.filesystem.entries.find((entry) =>
    entry.path.startsWith(workspacePrefix),
  )
  if (carried === undefined) return { ok: true }
  return {
    ok: false,
    reason:
      "API gap: filesystem.export includes the /workspace host mount (" +
      carried.path +
      "), so the snapshot cannot be restored into a room that projects that worktree",
  }
}

/** The hash a room records, so a resume restores the bytes pause captured and no others. */
export const snapshotHash = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex")

/**
 * What a pause captured, as `room.json` keeps it.
 *
 * `path` and `sha256` are the pair a resume checks; `bytes` and `entries` are what an operator
 * reads without opening the file.
 */
export const VmSnapshot = Schema.Struct({
  path: Schema.String,
  sha256: Schema.String,
  bytes: Schema.Int,
  entries: Schema.Int,
  generation: Schema.Int,
  at: Schema.Int,
})
export type VmSnapshot = typeof VmSnapshot.Type

/** One pause's outcome: the snapshot it recorded, or the reason it recorded none. */
export type VmSnapshotOutcome =
  | { readonly ok: true; readonly snapshot: VmSnapshot }
  | { readonly ok: false; readonly reason: string }

/**
 * The shape a snapshot must have before a VM is built on it.
 *
 * Only the envelope is checked: everything below `entries` is passed through untouched.
 */
const VmSnapshotShape = Schema.Struct({
  kind: Schema.Literal("snapshot-export"),
  source: Schema.Struct({
    format: Schema.Literal("agentos-filesystem-snapshot-v1"),
    filesystem: Schema.Struct({ entries: Schema.Array(Schema.Struct({ path: Schema.String })) }),
  }),
})

/** Read one snapshot file, or the reason it is not one this room may restore. */
export const readSnapshot = async (
  path: string,
): Promise<
  | { readonly ok: true; readonly value: VmSnapshotExport; readonly text: string }
  | { readonly ok: false; readonly reason: string }
> => {
  const text = await readFile(path, "utf8").catch(() => undefined)
  if (text === undefined) return { ok: false, reason: "there is no snapshot at " + path }
  const decoded = Schema.decodeResult(Schema.fromJsonString(VmSnapshotShape))(text)
  if (Result.isFailure(decoded))
    return {
      ok: false,
      reason:
        "the file at " + path + " is not a root filesystem snapshot: " + String(decoded.failure),
    }
  // SAFETY: the text decoded as a snapshot envelope above. It is parsed again rather than reusing
  // `decoded.success`, because the decoder keeps only the fields this schema names — and an entry
  // whose `content` it dropped would restore as an empty file.
  return { ok: true, value: JSON.parse(text) as VmSnapshotExport, text }
}

/**
 * Check that a recorded snapshot is still the one pause captured.
 *
 * A resume that restored whatever happened to be at the path would be indistinguishable from one
 * that restored the room's disk, so the hash is the claim: the file is read, hashed, and refused
 * when it is not the recorded one.
 */
export const verifySnapshot = async (
  snapshot: VmSnapshot,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> => {
  const read = await readSnapshot(snapshot.path)
  if (!read.ok) return read
  const sha256 = snapshotHash(read.text)
  if (sha256 !== snapshot.sha256)
    return {
      ok: false,
      reason:
        "the snapshot at " +
        snapshot.path +
        " is not the one pause recorded (sha256 " +
        sha256 +
        ", recorded " +
        snapshot.sha256 +
        ")",
    }
  return { ok: true }
}
