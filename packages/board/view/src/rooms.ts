import { Schema } from "effect"

/*
 * The /rooms document, as the view decodes it.
 *
 * A room is the board's own control-plane record: the same bytes the POST handlers in
 * `room store` mutate. The view reads them and never derives room state from /presence, so a
 * room the list shows is a room the board served, not one the page reconstructed.
 */

/** The journal a room reopens: where it lives, and whether its bytes are there now. */
export const RoomJournal = Schema.Struct({
  path: Schema.String,
  state: Schema.String,
})

/** The lifecycle verbs the board exposes under `POST /rooms/:id/<action>`. */
export const RoomAction = Schema.Literals(["start", "up", "pause", "resume", "down"])
export type RoomAction = typeof RoomAction.Type

/** One room as the board serves it. Absent fields are ones the board did not know. */
export const RoomRecord = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  runtime: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Finite),
  socket: Schema.optional(Schema.String),
  session: Schema.optional(Schema.NullOr(RoomJournal)),
  vm: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        state: Schema.String,
        pid: Schema.optional(Schema.Finite),
      }),
    ),
  ),
  /**
   * The board's own preview route, present only when the service answered a probe.
   *
   * A room no workstream or candidate names has no route the board can resolve, so it carries
   * none rather than a link that would 404.
   */
  preview: Schema.optional(Schema.String),
})
export type RoomRecord = typeof RoomRecord.Type

export const RoomList = Schema.Struct({ rooms: Schema.Array(RoomRecord) })
export type RoomList = typeof RoomList.Type

/** The five fields a new room is created from, as the form holds them. */
export const RoomForm = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  scope: Schema.String,
  base: Schema.String,
  software: Schema.String,
})
export type RoomForm = typeof RoomForm.Type

export const RoomFormField = Schema.Literals(["id", "repo", "scope", "base", "software"])
export type RoomFormField = typeof RoomFormField.Type

/**
 * The form a room is created from when the page first opens.
 *
 * The base is `main` because that is the room command's own default: a field the caller leaves
 * alone must create the room the CLI would create, not a different one.
 */
export const emptyRoomForm: RoomForm = {
  id: "",
  repo: "",
  scope: "",
  base: "main",
  software: "",
}
