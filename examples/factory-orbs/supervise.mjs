/*
 * The supervisor's view of two factories. It talks to each external port, never to the other
 * factory's filesystem or container. Run it from this directory.
 */
const ports = { a: 4901, b: 4902 }
const origin = (name) => "http://127.0.0.1:" + (ports[name] ?? 4901)

const state = async (name) => {
  const response = await fetch(origin(name) + "/api/state")
  if (!response.ok) throw new Error(name + ": HTTP " + response.status)
  return await response.json()
}

const note = async (name, text) => {
  const response = await fetch(origin(name) + "/api/note", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note: text }),
  })
  if (!response.ok) throw new Error(name + ": HTTP " + response.status)
  return await response.json()
}

const [command, target, ...rest] = process.argv.slice(2)
if (command === "status") {
  console.log(JSON.stringify({ a: await state("a"), b: await state("b") }, null, 2))
} else if (command === "note" && (target === "a" || target === "b") && rest.length > 0) {
  console.log(JSON.stringify(await note(target, rest.join(" ")), null, 2))
} else {
  console.error("usage: node supervise.mjs status | node supervise.mjs note a|b <text>")
  process.exit(2)
}
