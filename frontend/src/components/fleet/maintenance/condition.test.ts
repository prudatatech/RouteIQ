import { describe, expect, it } from 'vitest'
import type { ServiceItem } from '../health'
import { documentBar, odometerNote, serviceBar } from './condition'

const item = (over: Partial<ServiceItem>): ServiceItem => ({
  id: 'p1', vehicle_id: 'v1', item: 'Engine oil', interval_km: 10000, interval_days: 180, last_done_km: 40000, last_done_at: '2026-06-01',
  status: 'ok', km_remaining: 7000, days_remaining: 120, next_due_km: 50000, next_due_at: '2026-11-28', summary: '', ...over,
})

describe('serviceBar', () => {
  it('is green with plenty left and shows what runs out first', () => {
    // 70% of the km interval left, 67% of the day interval left: the days run out first
    const bar = serviceBar(item({}))
    expect(bar).toMatchObject({ state: 'ok', headline: '120 days left', detail: '7,000 km left' })
    expect(bar.fill).toBeCloseTo(0.667, 2)
  })

  it('takes whichever measure has the smaller share left', () => {
    const byDays = serviceBar(item({ km_remaining: 9000, days_remaining: 18 }))
    expect(byDays).toMatchObject({ state: 'urgent', headline: '18 days left', detail: '9,000 km left' })
  })

  it('turns amber at 30% left and red at 10% left', () => {
    expect(serviceBar(item({ km_remaining: 3000, days_remaining: 170 })).state).toBe('watch')
    expect(serviceBar(item({ km_remaining: 1000, days_remaining: 170 })).state).toBe('urgent')
    expect(serviceBar(item({ km_remaining: 3001, days_remaining: 170 })).state).toBe('ok')
  })

  it('is overdue and full when either measure is past due', () => {
    const bar = serviceBar(item({ km_remaining: -320, days_remaining: 40 }))
    expect(bar).toMatchObject({ state: 'overdue', fill: 1, headline: 'Overdue by 320 km', detail: '40 days left' })
    expect(serviceBar(item({ km_remaining: null, interval_km: null, days_remaining: -1 }))).toMatchObject({ state: 'overdue', headline: 'Overdue by 1 day', detail: null })
  })

  it('handles an item measured by one thing only', () => {
    const battery = serviceBar(item({ item: 'Battery', interval_km: null, km_remaining: null, interval_days: 1095, days_remaining: 700 }))
    expect(battery).toMatchObject({ state: 'ok', headline: '700 days left', detail: null })
  })

  it('is unknown when there is no baseline', () => {
    const bar = serviceBar(item({ km_remaining: null, days_remaining: null, summary: 'Log when this was last done to start tracking it' }))
    expect(bar).toMatchObject({ state: 'unknown', fill: 0, headline: 'Not tracked yet' })
  })
})

describe('documentBar', () => {
  const now = Date.parse('2026-09-29T06:00:00Z')

  it('counts days left against a year', () => {
    const bar = documentBar('rc', 'RC', '2027-03-29', now)
    expect(bar).toMatchObject({ state: 'ok', headline: '181 days left' })
    expect(bar.fill).toBeCloseTo(181 / 365, 3)
  })

  it('goes amber inside 60 days and red inside 30', () => {
    expect(documentBar('puc', 'PUC', '2026-11-20', now).state).toBe('watch')
    expect(documentBar('puc', 'PUC', '2026-10-20', now).state).toBe('urgent')
    expect(documentBar('puc', 'PUC', '2026-09-29', now)).toMatchObject({ state: 'urgent', headline: 'Expires today' })
  })

  it('is overdue once expired', () => {
    expect(documentBar('ins', 'Insurance', '2026-09-01', now)).toMatchObject({ state: 'overdue', fill: 1, headline: 'Expired 28 days ago' })
  })

  it('says so when no expiry is on file', () => {
    expect(documentBar('permit', 'Permit', null, now)).toMatchObject({ state: 'unknown', headline: 'No expiry on file' })
    expect(documentBar('permit', 'Permit', 'not a date', now).state).toBe('unknown')
  })
})

describe('odometerNote', () => {
  const rel = (v: string) => `<${v}>`
  it('says how the reading was last updated', () => {
    expect(odometerNote({ odometer_updated_at: 'a', odometer_synced_at: 'b', odometer_source: 'gps' }, rel)).toBe('Auto-synced <b> from GPS')
    expect(odometerNote({ odometer_updated_at: 'a', odometer_synced_at: 'b', odometer_source: 'routes' }, rel)).toBe('Auto-synced <b> from completed routes')
    expect(odometerNote({ odometer_updated_at: 'a', odometer_synced_at: 'b', odometer_source: 'manual' }, rel)).toBe('Entered by hand <a>')
    expect(odometerNote({ odometer_updated_at: 'a', odometer_synced_at: null, odometer_source: null }, rel)).toBe('Counted from GPS distance, updated <a>')
    expect(odometerNote({ odometer_updated_at: null, odometer_synced_at: null, odometer_source: null }, rel)).toMatch(/Not synced yet/)
  })
})
