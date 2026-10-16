import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ChildProcessSpawner } from "effect/process"

/** The spawner service, under the name `effect/process` exports it as. */
export type Spawner = ChildProcessSpawner.ChildProcessSpawner

/*
 * The one place `jig` touches the outside world.
 *
 * A linter exits non-zero when it finds something; that is a RESULT, not a failure, so
 * this returns the exit code instead of raising it. The only thing that counts as a
 * failure here is the process not starting at all (a missing binary), and even then the
 * caller degrades to a note rather than stopping the run — one absent tool must not
 * silence the other engines.
 */

export interface ExecOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

/** Run a binary and collect its streams and exit code. The error channel is a message. */
export const exec = (
  binary: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<ExecOutcome, string, Spawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(binary, [...args], { cwd })
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      )
      return { stdout, stderr, code: Number(exitCode) }
    }),
  ).pipe(Effect.mapError((cause) => (cause instanceof Error ? cause.message : String(cause))))
