import type { AgentOsSidecar, Permissions } from "@rivet-dev/agentos-core"
import { Schema } from "effect"

/*
 * What a room's guest may reach, declared at the room boundary instead of inherited on faith.
 *
 * `AgentOsOptions.permissions` (`agent-os.d.ts:474`) is optional, and an omitted policy keeps the
 * sidecar's own default: its virtual filesystem, processes, environment, listeners and loopback
 * work, and external network access is limited by a service allowlist the sidecar owns. That is a
 * defensible sandbox, but it is not a room's declaration — nothing in the repo said it, so nothing
 * could be read back. This module is the declaration, and the record an operator reads instead.
 *
 * Two facts about the pin decide the shape, both read from
 * `@rivet-dev/agentos-core@0.4.9`:
 *
 * - A scope's `mode` is `"allow" | "deny"` (`runtime.d.ts:3`, `PermissionMode`). The generated
 *   type mentions `"ask"` (`generated/PermissionMode.d.ts`), but the option schema the sidecar
 *   validates accepts only the two (`options-schema.d.ts:permissionsSchema`), so `"ask"` is not
 *   expressible here and is not written.
 * - The operations a rule names are not in any declaration. They are the operation table the
 *   sidecar compiles in; the 0.4.9 sidecar binary carries `network.fetch`, `network.http`,
 *   `network.dns` and `network.listen` beside `child_process.spawn` and `fs.read`. A rule's
 *   `patterns` are matched against the host of the request (`NetworkAccessRequest` carries
 *   `host`, `port`, `protocol`, `url` at `runtime.d.ts:59`).
 */

/**
 * The hosts a room's guest may reach on its own loopback: the room's service, and nothing else.
 *
 * They are listed literally rather than as a wildcard because the wildcard form the runtime
 * documents is the pattern-set default (`**`), not a host glob this module would be guessing at.
 */
export const roomAllowedHosts: ReadonlyArray<string> = ["127.0.0.1", "localhost", "::1"]

/**
 * The one policy every room's VM is created with.
 *
 * Only `network` is declared. The other scopes — `fs`, `childProcess`, `process`, `env`,
 * `hostFunction` — are merged over the sidecar's default, so omitting them keeps exactly the
 * sandbox a room has always had; naming them would be restating the runtime, not deciding
 * anything about a room.
 *
 * The network scope is the decision: deny by default, then allow the two things a room's work is.
 * A listener is what a room's service *is* — the guest binds a loopback port and the host bridge
 * reaches it — so `network.listen` is allowed with no pattern, and the runtime already refuses a
 * bind outside loopback. A guest reaching its own service is `network.fetch`/`network.http` on
 * loopback; everything else — every external host, including the model-API hosts the sidecar's own
 * allowlist grants — is denied. A room that needs to reach the network says so here, in one place,
 * with the test that proves it.
 */
export const roomVmPermissions: Permissions = {
  network: {
    default: "deny",
    rules: [
      { mode: "allow", operations: ["network.listen"] },
      {
        mode: "allow",
        operations: ["network.fetch", "network.http", "network.dns"],
        patterns: [...roomAllowedHosts],
      },
    ],
  },
}

/** The mode a scope applies when no rule matches; `"deny"` is the room's own default. */
export const PermissionMode = Schema.Literal("allow", "deny")
export type PermissionMode = typeof PermissionMode.Type

const PatternRule = Schema.Struct({
  mode: PermissionMode,
  operations: Schema.optional(Schema.Array(Schema.String)),
  patterns: Schema.optional(Schema.Array(Schema.String)),
})
const PatternRuleSet = Schema.Struct({
  default: Schema.optional(PermissionMode),
  rules: Schema.Array(PatternRule),
})

/** The network scope as it was passed, verbatim: a bare mode, or a default with rules. */
export const NetworkPolicy = Schema.Union([PermissionMode, PatternRuleSet])
export type NetworkPolicy = typeof NetworkPolicy.Type

/**
 * Where the sidecar runs, narrowed to what a room file may hold.
 *
 * `AgentOsSidecarPlacement` (`agent-os.d.ts:170`–`:175`) is either a shared pool or an explicit
 * handle — and a handle is a live object, not JSON. A record that kept it could not be written, so
 * the placement is kept as its kind and, for a shared sidecar, its pool name.
 */
export const SidecarPlacement = Schema.Struct({
  kind: Schema.Literal("shared", "explicit"),
  pool: Schema.optional(Schema.String),
})

/**
 * `AgentOsSidecar.describe()` (`agent-os.d.ts:898`), which is what the sidecar says about itself.
 *
 * It is *not* a policy report: `AgentOsSidecarDescription` (`:176`–`:181`) has exactly
 * `sidecarId`, `placement`, `state` and `activeVmCount`, and no member for the permissions a VM
 * was created with. Cut 4 of `docs/tech-seams.md` assumed `describe()` would tell an operator what
 * a room may reach; at 0.4.9 it cannot, and this record does not pretend otherwise — `network`
 * below is the declaration the room made, and `sidecar` is the identity/state the runtime
 * confirmed. ADR 0007 records the gap.
 */
export const SidecarDescription = Schema.Struct({
  sidecarId: Schema.String,
  placement: SidecarPlacement,
  state: Schema.Literal("ready", "disposing", "disposed"),
  activeVmCount: Schema.Int,
})
export type SidecarDescription = typeof SidecarDescription.Type

/**
 * What a room records about its guest's reach: the policy it applied, and the sidecar it applied
 * it on.
 *
 * `declared` names the scopes this room set. A scope it does not name is the sidecar's default,
 * which is a fact about the runtime and not a claim this record can make; listing it would be the
 * guess the environment plan forbids.
 */
export const VmPermissionsReport = Schema.Struct({
  declared: Schema.Array(Schema.String),
  network: NetworkPolicy,
  sidecar: Schema.optional(SidecarDescription),
})
export type VmPermissionsReport = typeof VmPermissionsReport.Type

/**
 * The policy a report records, in the shape the room file keeps it.
 *
 * It is decoded rather than cast: a policy the record could not express would otherwise be
 * written by the boot and refused by every later read, which is a room that boots and then
 * cannot be read.
 */
const networkOf = (permissions: Permissions): NetworkPolicy =>
  Schema.decodeUnknownSync(NetworkPolicy)(permissions.network ?? "deny")

/** The scopes a policy sets, in a stable order, so a record does not depend on key order. */
export const declaredScopes = (permissions: Permissions): ReadonlyArray<string> =>
  (["fs", "network", "childProcess", "process", "env", "hostFunction"] as const).filter(
    (scope) => permissions[scope] !== undefined,
  )

/** The sidecar's own description, or nothing when the VM did not expose one. */
export const describeSidecar = (
  sidecar: AgentOsSidecar | undefined,
): SidecarDescription | undefined => {
  if (sidecar === undefined) return undefined
  const described = sidecar.describe()
  return {
    sidecarId: described.sidecarId,
    placement:
      described.placement.kind === "shared"
        ? {
            kind: "shared",
            ...(described.placement.pool === undefined ? {} : { pool: described.placement.pool }),
          }
        : { kind: "explicit" },
    state: described.state,
    activeVmCount: described.activeVmCount,
  }
}

/** Compose the policy a room passed with what the sidecar said about itself into one record. */
export const permissionsReport = (input: {
  readonly permissions: Permissions
  readonly sidecar: AgentOsSidecar | undefined
}): VmPermissionsReport => {
  const sidecar = describeSidecar(input.sidecar)
  return {
    declared: [...declaredScopes(input.permissions)],
    network: networkOf(input.permissions),
    ...(sidecar === undefined ? {} : { sidecar }),
  }
}

/**
 * The one line `room status` prints about a room's reach, or nothing at all.
 *
 * Nothing is the answer for a record that is absent — a room written or booted before the policy
 * was recorded — and for a record whose sidecar said nothing about itself. A guessed line would be
 * worse than a missing one: it would report a policy no VM was created with.
 */
export const permissionsLine = (permissions: VmPermissionsReport | undefined): string => {
  if (permissions === undefined) return ""
  const network = permissions.network
  const mode = typeof network === "string" ? network : (network.default ?? "undeclared")
  const allowed =
    typeof network === "string"
      ? []
      : network.rules.filter((rule) => rule.mode === "allow").flatMap((rule) => rule.patterns ?? [])
  const sidecar = permissions.sidecar === undefined ? "" : " sidecar " + permissions.sidecar.state
  return (
    " permissions network " +
    mode +
    (allowed.length === 0 ? "" : " allow " + allowed.join(",")) +
    sidecar
  )
}
