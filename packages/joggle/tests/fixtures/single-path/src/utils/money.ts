const currency = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" })

/** The one place money becomes a string. */
export function formatDollar(value: number): string {
  return currency.format(value)
}
