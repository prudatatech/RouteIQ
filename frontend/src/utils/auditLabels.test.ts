import { describe, expect, it } from 'vitest'
import { auditActionLabel, auditSourceLabel } from './auditLabels'

describe('audit labels', () => {
  it('turns known keys into sentences', () => {
    expect(auditActionLabel('driver_pay.paid')).toBe('Driver pay paid')
    expect(auditActionLabel('invoice_paid')).toBe('Invoice marked paid')
  })
  it('never shows a raw key for an unknown action', () => {
    expect(auditActionLabel('new_thing.happened')).toBe('New thing happened')
    expect(auditActionLabel(null)).toBe('—')
  })
  it('names the source', () => {
    expect(auditSourceLabel('staff-console')).toBe('Staff')
    expect(auditSourceLabel('system')).toBe('System')
  })
})
