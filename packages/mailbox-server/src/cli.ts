import { parseArgs } from "node:util"
import { startMailboxService } from "./service.ts"

const usage = [
  "mailbox-server — the mailbox as a process",
  "",
  "Usage: mailbox-server serve [--host 127.0.0.1] [--port 4781] [--state .mailbox/state.json]",
  "",
  "Routes: /health, /xrpc/dev.autotelic.mailbox.{send,deliver,ack,acquire,release,list}",
].join("\n")

const fail = (message: string): never => {
  console.error("mailbox-server: " + message)
  process.exit(1)
}

const main = async (): Promise<void> => {
  const command = process.argv[2]
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage)
    return
  }
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
