import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The lint-facing catalog, read as bytes.
 *
 * `plumb` does not import `@autotelic/protocol`: the seam is the file, and a rule that
 * imported the generator would make a tool and its checker one program. This decoder is
 * deliberately tolerant, matching cutlist's own reader, so a manifest written by a newer
 * generator still yields the parts this rule understands.
 *
 * The only fields this rule needs are identity (`path`, `name`, `exports`), lifecycle
 * (`status`), and the migration target (`useInstead`). Everything else is ignored.
 */

/** Where a part is in its life. */
export type UiPartStatus = "stable" | "beta" | "experimental" | "deprecated";

/** The subset of a manifest component the deprecation rule reads. */
export interface UiPart {
	readonly path: string;
	readonly name: string;
	readonly exports?: ReadonlyArray<string>;
	readonly status?: UiPartStatus;
	readonly useInstead?: ReadonlyArray<string>;
}

/** A manifest, reduced to the parts the rule can act on. */
export interface UiManifest {
	readonly components: ReadonlyArray<UiPart>;
}

const STATUSES: ReadonlyArray<UiPartStatus> = ["stable", "beta", "experimental", "deprecated"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function strings(value: unknown): ReadonlyArray<string> | undefined {
	if (!Array.isArray(value)) return undefined;
	if (!value.every((entry) => typeof entry === "string")) return undefined;
	return value;
}

function status(value: unknown): UiPartStatus | undefined {
	return STATUSES.find((entry) => entry === value);
}

/**
 * Read one component, or `undefined` when it cannot be identified.
 *
 * `tier`, `owners`, `props` and `tags` are required by the manifest schema but not by
 * this rule. Requiring them here would make a hand-written fixture verbose for no gain,
 * and the rule's question is only "who is deprecated, and what replaces it".
 */
export function decodeUiPart(value: unknown): UiPart | undefined {
	if (!isRecord(value)) return undefined;
	const path = str(value.path);
	const name = str(value.name);
	if (path === undefined || name === undefined) return undefined;
	const exports = strings(value.exports);
	const partStatus = status(value.status);
	const useInstead = strings(value.useInstead);
	return {
		path,
		name,
		...(exports === undefined ? {} : { exports }),
		...(partStatus === undefined ? {} : { status: partStatus }),
		...(useInstead === undefined ? {} : { useInstead }),
	};
}

/** Read a manifest, or `undefined` when it is not one. */
export function decodeUiManifest(value: unknown): UiManifest | undefined {
	if (!isRecord(value) || !Array.isArray(value.components)) return undefined;
	const components: Array<UiPart> = [];
	for (const entry of value.components) {
		const part = decodeUiPart(entry);
		if (part !== undefined) components.push(part);
	}
	return { components };
}

/**
 * Read a manifest from disk, degrading to `undefined`.
 *
 * A missing or malformed manifest is not a lint error: the rule goes quiet, exactly as
 * every other manifest reader in this workspace does. `cutlist build --check` is the
 * gate that makes a stale manifest loud.
 */
export function readUiManifest(path: string): UiManifest | undefined {
	try {
		return decodeUiManifest(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return undefined;
	}
}

/** Resolve a configured path against the process working directory. */
export function manifestAt(path: string): UiManifest | undefined {
	return readUiManifest(resolve(process.cwd(), path));
}
