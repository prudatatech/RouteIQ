/**
 * Rules from Indian law that screens warn about. They only warn: nothing here blocks a dispatch.
 */

/**
 * Goods worth more than this (₹) need an e-way bill to move by road. One constant, so a change in
 * the rule is one edit; every warning and its text read it.
 */
export const EWAY_BILL_THRESHOLD_RUPEES = 50_000

/** The badge text staff see. Built from the constant, never typed out. */
export const EWAY_BILL_WARNING = `E-way bill needed (value over ₹${EWAY_BILL_THRESHOLD_RUPEES.toLocaleString('en-IN')})`

/** True when declared goods are over the threshold and no e-way bill number is on record. */
export function needsEwayBill(declaredValue: number | string | null | undefined, ewayBillRef: string | null | undefined): boolean {
  const value = Number(declaredValue)
  if (!Number.isFinite(value) || value <= EWAY_BILL_THRESHOLD_RUPEES) return false
  return !(ewayBillRef ?? '').trim()
}

/** The government portal where an e-way bill is made and its vehicle number (Part B) updated. */
export const EWAY_BILL_PORTAL_URL = 'https://ewaybillgst.gov.in'
