export interface Row {
  id: string
  total: number
}

export function normalise(row: Row): Row {
  return row
}

export function validate(row: Row): Row {
  return row
}

export function save(row: Row): Row {
  return row
}

export function toNumber(value: unknown): number {
  return Number(value)
}

export function round(value: number): number {
  return Math.round(value)
}

/** The primitive: one name for the three calls in order. */
export function cleanRow(row: Row): Row {
  return save(validate(normalise(row)))
}
