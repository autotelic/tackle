export interface Payroll {
  useSwaDayRate: boolean
  totalPay: number
  pieceRatePay: number
  swaPayTotal: number
  payAfterSwaDeduction: number
}

export function readingOf(payroll: Payroll): string {
  if (payroll.useSwaDayRate) {
    return String(payroll.payAfterSwaDeduction + payroll.swaPayTotal)
  }
  return String(payroll.pieceRatePay)
}
