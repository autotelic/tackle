import { Effect } from "effect"

/** What one Copy tap achieved: the clipboard, a visible selection, or neither. */
export type CopyOutcome = "copied" | "selected" | "unavailable"

export type CopyRequest = {
  readonly text: string
  /** The guarded `navigator.clipboard.writeText`; absent when the API is. */
  readonly writeText?: ((text: string) => Promise<void>) | undefined
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
  writeText,
  select,
}: CopyRequest): Effect.Effect<CopyOutcome> => {
  if (writeText === undefined) return selection(select)
  return Effect.tryPromise({
    try: () => writeText(text),
    catch: (cause) => String(cause),
  }).pipe(
    Effect.as("copied" as const),
    Effect.catch(() => selection(select)),
  )
}
