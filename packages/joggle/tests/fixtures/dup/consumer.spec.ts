import { escapeCsv } from "./prod"

// A spec that re-implements the function it tests. The assertions run against
// this copy, so they pass whatever production does. This SHOULD be reported.
function escapeCsvCopy(value: string | null): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  if (text.includes(",") || text.includes('\"') || text.includes("\n")) {
    return '"' + text.replace(/\"/g, '""') + '"'
  }
  return text
}

// Two fixtures in one spec file, which is what a factory is for. This should
// NOT be reported.
function buildRowA(id: string, name: string, total: number): string {
  return [id, name, String(total)].join(",")
}

function buildRowB(id: string, name: string, total: number): string {
  return [id, name, String(total)].join(",")
}

export { escapeCsv, escapeCsvCopy, buildRowA, buildRowB }
