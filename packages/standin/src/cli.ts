import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { MissLedger } from "./misses.ts"

const usage =
  "usage: standin misses --ledger <path> [--format text|json]\n" +
  "       text: one line per miss, sorted by count then hash\n" +
  '       json: { "misses": [...] } with the ledger rows'

const fail = (message: string): number => {
  process.stderr.write(message + "\n" + usage + "\n")
  return 1
}

const write = (text: string): void => {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n")
}

/**
 * `standin misses` — read a ledger and print it.
 *
 * This is the thin boundary: parse the arguments, load the artifact, hand the ledger to
 * the renderer. No judging lives here, and no ledger is written, because a report is not
 * allowed to edit the thing it reports on.
 */
export const main = (argv: ReadonlyArray<string>): number => {
  let values: { readonly ledger?: string | undefined; readonly format?: string | undefined }
  let positionals: ReadonlyArray<string>
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        ledger: { type: "string" },
        format: { type: "string", default: "text" },
      },
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  if (positionals[0] !== "misses") return fail("expected the `misses` command")
  const ledgerPath = values.ledger
  if (ledgerPath === undefined || ledgerPath === "") {
    return fail("expected --ledger <path>")
  }
  const format = values.format ?? "text"
  if (format !== "text" && format !== "json") {
    return fail("expected --format text or --format json")
  }

  let text: string
  try {
    text = readFileSync(ledgerPath, "utf8")
  } catch (error) {
    return fail(
      "could not read the ledger at " +
        ledgerPath +
        ": " +
        (error instanceof Error ? error.message : String(error)),
    )
  }

  const ledger = MissLedger.decode(text)
  if (format === "json") {
    write(JSON.stringify({ misses: ledger.snapshot() }, null, 2))
    return 0
  }
  const rendered = ledger.render()
  if (rendered !== "") write(rendered)
  return 0
}

process.exitCode = main(process.argv.slice(2))
