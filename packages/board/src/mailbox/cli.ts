import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { startMailboxService } from "./service.ts"

/** A file may be the envelope itself or the fixture shape that wraps it. */
const WrappedEnvelope = Schema.Struct({ envelope: Schema.Unknown })

const usage = [
  "mailbox-server — the mailbox as a process, and a client for it",
  "",
  "Usage:",
  "  mailbox-server serve [--host 127.0.0.1] [--port 4781] [--state .mailbox/state.json]",
  "  mailbox-server list --url <url> --recipient <did> [--after 0]",
  "  mailbox-server send --url <url> --actor <did> --envelope <file.json>",
  "",
  "Routes: /health, /xrpc/dev.autotelic.mailbox.{send,deliver,ack,acquire,release,list}",
].join("\n")

const fail = (message: string): never => {
  console.error("mailbox-server: " + message)
  process.exit(1)
}

/** Print the JSON body and make a non-2xx response fail the process. */
const show = async (response: Response): Promise<void> => {
  const text = await response.text()
  const body = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
  if (Result.isSuccess(body)) console.log(JSON.stringify(body.success, null, 2))
  else console.log(text.trimEnd())
  if (!response.ok) process.exitCode = 1
}

const list = async (args: ReadonlyArray<string>): Promise<void> => {
  const parsed = parseArgs({
    args,
    options: {
      url: { type: "string", default: "http://127.0.0.1:4781" },
      recipient: { type: "string" },
      after: { type: "string", default: "0" },
    },
    allowPositionals: false,
  })
  if (parsed.values.recipient === undefined) return fail("list needs --recipient")
  const query =
    "?recipientDid=" +
    encodeURIComponent(parsed.values.recipient) +
    "&afterSeq=" +
    encodeURIComponent(parsed.values.after)
  await show(await fetch(parsed.values.url + "/xrpc/dev.autotelic.mailbox.list" + query))
}

const send = async (args: ReadonlyArray<string>): Promise<void> => {
  const parsed = parseArgs({
    args,
    options: {
      url: { type: "string", default: "http://127.0.0.1:4781" },
      actor: { type: "string" },
      envelope: { type: "string" },
    },
    allowPositionals: false,
  })
  if (parsed.values.actor === undefined) return fail("send needs --actor")
  if (parsed.values.envelope === undefined) return fail("send needs --envelope <file.json>")
  const text = await readFile(parsed.values.envelope, "utf8")
  const envelope = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
  if (Result.isFailure(envelope)) return fail("the envelope file is not JSON")
  const value = Schema.is(WrappedEnvelope)(envelope.success)
    ? envelope.success.envelope
    : envelope.success
  await show(
    await fetch(parsed.values.url + "/xrpc/dev.autotelic.mailbox.send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actorDid: parsed.values.actor, envelope: value }),
    }),
  )
}

const main = async (): Promise<void> => {
  const command = process.argv[2]
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage)
    return
  }
  if (command === "list") return list(process.argv.slice(3))
  if (command === "send") return send(process.argv.slice(3))
  if (command !== "serve") return fail("unknown command " + command + " (see --help)")
  const parsed = parseArgs({
    args: process.argv.slice(3),
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4781" },
      state: { type: "string", default: ".mailbox/state.json" },
    },
    allowPositionals: false,
  })
  const port = Number(parsed.values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return fail("--port must be an integer between 1 and 65535")
  const service = await startMailboxService({
    host: parsed.values.host,
    port,
    statePath: parsed.values.state,
  })
  console.log("mailbox-server: " + service.url + " (pid " + process.pid + ")")
  const shutdown = (): void => {
    void service.close().finally(() => process.exit(0))
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

main().catch((cause) => fail(String(cause)))
