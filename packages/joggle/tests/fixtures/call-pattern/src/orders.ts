/**
 * Two functions that make the same four calls in the same order. Whether they are
 * one orchestration is the question; the shared call sequence is the fact.
 */
interface Row {
  id: string
}

function validate(row: Row): Row {
  return row
}

function normalise(row: Row): Row {
  return row
}

function persist(row: Row): Row {
  return row
}

function notify(row: Row): Row {
  return row
}

export function saveOrder(row: Row): Row {
  validate(row)
  normalise(row)
  persist(row)
  notify(row)
  return row
}

export function saveOrderAgain(row: Row): Row {
  if (row.id === "") {
    throw new Error("missing id")
  }
  validate(row)
  normalise(row)
  persist(row)
  notify(row)
  return row
}
