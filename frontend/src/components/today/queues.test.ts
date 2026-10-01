import { describe, expect, it } from 'vitest'
import type { TodayResponse } from '@/services/api'
import { buildQueues, splitQueues } from './queues'

const base: TodayResponse = {
  scope: 'all',
  generated_at: '2026-09-30T10:00:00Z',
  queues: {
    sos: { count: 1 },
    problems: { count: 4, overdue: 2 },
    requests: { count: 3, bookings: 2, vendor_loads: 1 },
    needs_vehicle: { count: 5, shipments: 4, vendor_loads: 1 },
    trips_to_send: { count: 0 },
    vehicle_requests: { count: 2 },
    documents: { count: 0 },
    driver_actions: { count: 1 },
    unpriced: { count: 3, no_price: 2 },
    payment_reports: { count: 2 },
    kyc: { count: 1 },
    bids: { count: 0 },
  },
  live: { active_trips: 2, vehicles_on_road: 2, on_time_rate_pct: 50 },
}

describe('the work queues', () => {
  it('run most urgent first', () => {
    expect(buildQueues(base).map(q => q.id)).toEqual([
      'sos', 'problems', 'requests', 'needsVehicle', 'tripsToSend', 'unpriced', 'paymentReports', 'vehicleRequests', 'documents', 'kyc', 'bids', 'driverActions',
    ])
  })

  it('open the exact filtered list', () => {
    const to = Object.fromEntries(buildQueues(base).map(q => [q.id, q.to]))
    expect(to.sos).toBe('/emergency')
    expect(to.problems).toBe('/cargo?overdue=1')
    expect(to.requests).toBe('/requests')
    expect(to.needsVehicle).toBe('/dispatch?tab=needs-vehicle')
    expect(to.tripsToSend).toBe('/routes?status=pending')
    expect(to.bids).toBe('/bids?tab=decide')
    expect(to.paymentReports).toBe('/money?tab=invoices&reports=open')
  })

  it('open all problems when none is overdue', () => {
    const queues = buildQueues({ ...base, queues: { ...base.queues, problems: { count: 1, overdue: 0 } } })
    expect(queues.find(q => q.id === 'problems')!.to).toBe('/cargo?tab=exceptions')
  })

  it('say what each count is made of', () => {
    const byId = Object.fromEntries(buildQueues(base).map(q => [q.id, q]))
    expect(byId.requests.hint).toBe('2 customer bookings · 1 vendor load')
    expect(byId.problems.hint).toBe('2 overdue')
    expect(byId.unpriced.hint).toContain('2 have no price')
  })

  it('leave out the queues a manager does not get', () => {
    const { unpriced, kyc, bids, payment_reports, ...operations } = base.queues
    void unpriced; void kyc; void bids; void payment_reports
    const ids = buildQueues({ ...base, scope: 'operations', queues: operations }).map(q => q.id)
    expect(ids).not.toContain('unpriced')
    expect(ids).not.toContain('kyc')
    expect(ids).not.toContain('bids')
    expect(ids).not.toContain('paymentReports')
    expect(ids).toContain('sos')
  })

  it('separate what is waiting from what is clear', () => {
    const { waiting, clear } = splitQueues(buildQueues(base))
    expect(waiting.map(q => q.id)).toEqual(['sos', 'problems', 'requests', 'needsVehicle', 'unpriced', 'paymentReports', 'vehicleRequests', 'kyc', 'driverActions'])
    expect(clear.map(q => q.id)).toEqual(['tripsToSend', 'documents', 'bids'])
  })
})
