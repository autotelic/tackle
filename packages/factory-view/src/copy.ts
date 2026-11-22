import { Effect, Option } from "effect"

/** What one Copy tap achieved: the clipboard, a visible selection, or neither. */
export type CopyOutcome = "copied" | "selected" | "unavailable"

/** The part of `navigator.clipboard` this view uses; an insecure origin has none of it. */
export type ClipboardHost = {
  readonly writeText?: ((text: string) => Promise<void>) | undefined
}

const hasWriteText = (
  clipboard: ClipboardHost,
): clipboard is ClipboardHost & { readonly writeText: (text: string) => Promise<void> } =>
  clipboard.writeText !== undefined

/**
 * The guard the phone needs: `navigator.clipboard` is absent outside a secure
 * context and older Safari shipped it without `writeText`. It stays internal
 * because absence is answered here, by selecting the visible command, so no
 * caller ever sees an untyped null. The closure keeps the clipboard as its
 * receiver, which `writeText` requires.
 */
const clipboardWriteText = (
  clipboard: ClipboardHost | null | undefined,
): Option.Option<(text: string) => Promise<void>> =>
  Option.fromNullishOr(clipboard).pipe(
    Option.filter(hasWriteText),
    Option.map((host) => (text: string) => host.writeText(text)),
  )

export type CopyRequest = {
  readonly text: string
  /** The browser clipboard; null or undefined outside a secure context. */
  readonly clipboard?: ClipboardHost | null | undefined
  /** Selects the visible command text; false when there is nothing to select. */
  readonly select: () => boolean
}

const selection = (select: () => boolean): Effect.Effect<CopyOutcome> =>
  Effect.sync(() => (select() ? "selected" : "unavailable"))

/**
 * iOS Safari exposes the async clipboard only in a secure context and can still
 * reject the write, so both cases fall back to selecting the command text that is
 * already on screen: the operator copies it from the long-press menu. A missing
 * selection is the only outcome with nothing to hand over.
 */
export const copyOrSelect = ({
  text,
  clipboard,
  select,
}: CopyRequest): Effect.Effect<CopyOutcome> => {
  const writeText = Option.getOrUndefined(clipboardWriteText(clipboard))
  if (writeText === undefined) return selection(select)
  return Effect.tryPromise({
    try: () => writeText(text),
    catch: (cause) => String(cause),
  }).pipe(
    Effect.as("copied" as const),
    Effect.catch(() => selection(select)),
  )
}
