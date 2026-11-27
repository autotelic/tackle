import { Schema } from "effect"

/*
 * What a room's guest is made of, declared at the room boundary instead of inherited on faith.
 *
 * `AgentOsOptions.defaultSoftware` defaults to true, so a room that names nothing boots with
 * whatever bundle Core happens to vendor — at `@rivet-dev/agentos-core@0.4.9`,
 * `dist/default-software/default-software.json`: coreutils, sed, grep, gawk, findutils,
 * diffutils, tar, gzip. Not one of those is a tool a room's work needs. A Core release that
 * changed the bundle would turn a pass into a guest `command not found`, with nothing at boot
 * to say so. This module is the declaration that makes it a boot fact.
 */

/**
 * The software a room asks its VM to install: names in the agentOS software registry, resolved
 * through `<registry>/<version>/software/manifest.json` by the host process before `create`
 * resolves.
 */
export const RoomSoftware = Schema.Struct({
  packages: Schema.Array(Schema.String),
})
export type RoomSoftware = typeof RoomSoftware.Type

/**
 * The declaration a room that names none gets: the empty declaration.
 *
 * Empty is deliberate. A registry package is downloaded on the host before `create` resolves,
 * so defaulting to `git` would make every room boot depend on
 * `releases.rivet.dev` — a new network requirement on a tool whose tests and offline use must
 * work from a checkout. The Core bundle still provides its baseline; `runtime.software`
 * records what it actually installed. A room that needs `git` opts in with
 * `--software git`, and that boot fails honestly when the registry is unreachable.
 *
 * `node` is not a software package at all — the guest's `node` is the sidecar's own JS runtime
 * — and `pnpm` is published by neither the default bundle nor the registry. ADR 0006 records
 * the manifest those claims were read from.
 */
export const defaultRoomSoftware: RoomSoftware = { packages: [] }

/** The declaration a room file implies: an absent field is the default, never a bare VM. */
export const declaredSoftware = (software: RoomSoftware | undefined): RoomSoftware =>
  software ?? defaultRoomSoftware

/** One installed package, as `vm.software.installed()` reports it, minus its bigint size. */
export const InstalledPackage = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  commands: Schema.Array(Schema.String),
})
export type InstalledPackage = typeof InstalledPackage.Type

/**
 * What a room's VM booted with: the declaration, the VM's own report, and the gap between them.
 *
 * `installed` is always the VM's answer, never a list this package maintains — there is one
 * manifest of what a room has, and it is the runtime's. `missing` is the declared name the VM
 * does not list, which is the finding an operator needs: a declaration the release stopped
 * satisfying says so in the record instead of surfacing as `command not found` in the guest.
 */
export const VmSoftwareReport = Schema.Struct({
  declared: Schema.Array(Schema.String),
  installed: Schema.Array(InstalledPackage),
  missing: Schema.Array(Schema.String),
})
export type VmSoftwareReport = typeof VmSoftwareReport.Type

/** The registry entries `AgentOsOptions.software` takes for one declaration. */
export const softwareInputs = (
  software: RoomSoftware,
): ReadonlyArray<{ readonly registry: string }> =>
  software.packages.map((name) => ({ registry: name }))

/** Compose a declaration with the VM's own report into the one record a room keeps. */
export const softwareReport = (
  software: RoomSoftware,
  installed: ReadonlyArray<{
    readonly packageName: string
    readonly version: string
    readonly commands: ReadonlyArray<string>
  }>,
): VmSoftwareReport => {
  const reported: ReadonlyArray<InstalledPackage> = installed.map((entry) => ({
    name: entry.packageName,
    version: entry.version,
    commands: [...entry.commands],
  }))
  const present = new Set(reported.map((entry) => entry.name))
  return {
    declared: [...software.packages],
    installed: [...reported],
    missing: software.packages.filter((name) => !present.has(name)),
  }
}
