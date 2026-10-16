export function escapeCsv(value: string | null): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  if (text.includes(",") || text.includes('\"') || text.includes("\n")) {
    return '"' + text.replace(/\"/g, '""') + '"'
  }
  return text
}
