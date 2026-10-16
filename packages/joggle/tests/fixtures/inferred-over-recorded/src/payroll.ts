export interface Payroll {
  useSwaDayRate: boolean
  pieceRatePay: number
  swaPayTotal: number
}

export function isDayRate(payroll: Payroll): boolean {
  return payroll.pieceRatePay + payroll.swaPayTotal > 0
}

/** Contains a comparison, but returns a count rather than the boolean. */
export function countDayRate(payrolls: ReadonlyArray<Payroll>): number {
  let count = 0
  for (const payroll of payrolls) {
    if (payroll.pieceRatePay + payroll.swaPayTotal > 0) count += 1
  }
  return count
}
