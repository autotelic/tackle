import { Duration } from "effect"

/** The same arithmetic, but the family is imported, so there is no absence to report. */
export const wait = (millis: number) => Duration.millis((millis + 1_000) / 1_000)
