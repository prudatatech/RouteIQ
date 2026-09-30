import { describe, expect, it } from 'vitest'
import {
  actionItems, bidNextStep, claimableLoads, claimStatusText, daysSince, groupByStage, nextAction, type BoardState, type VendorInvoice, type VendorLoad,
} from './loads'

const NOW = Date.parse('2026-09-30T10:00:00Z')
const DAY = 86_400_000

function load(over: Partial<VendorLoad> = {}): VendorLoad {
  return {
    id: 'r1', kind: 'posted', code: 'CM-AAAA1111', request_id: 'r1', manifest_id: 'm1', shipment_id: null, bid_id: null,
    stage: 'on_the_way', status: 'in_transit', outcome: null, pickup: 'Pune', drop: 'Mumbai', weight_kg: 300, pieces: 4, price: 8000, price_source: 'agreed',
    truck: { plate_number: 'MH12AB0001', vehicle_type: 'truck' }, tracking_id: 'CM-AAAA1111', with_partner: false, rejection_reason: null,
    created_at: '2026-09-29T10:00:00Z', delivered_at: null, invoice: null, problems: [], ...over,
  }
}

function invoice(over: Partial<VendorInvoice> = {}): VendorInvoice {
  return {
    id: 'i1', invoice_number: 'INV-202609-0001', reference: 'CM-AAAA1111', shipment_id: null, manifest_id: 'm1', vendor_request_id: 'r1',
    amount: 8000, gst_rate: 5, gst_amount: 400, total: 8400, status: 'issued', issued_at: '2026-09-28T10:00:00Z', paid_at: null, ...over,
  }
}

const board = (over: Partial<BoardState> = {}): BoardState => ({ kyc: 'approved', locationMissing: false, loads: [], invoices: [], ...over })

describe('nextAction', () => {
  it('waits on MargixIndia while a load is waiting, accepted or on the way', () => {
    expect(nextAction(load({ stage: 'waiting', status: 'pending' }))).toMatchObject({ kind: 'wait', label: 'Waiting on MargixIndia' })
    expect(nextAction(load({ stage: 'accepted', status: 'approved' }))).toMatchObject({ kind: 'wait', detail: 'To assign a truck' })
    expect(nextAction(load({ stage: 'accepted', with_partner: true }))).toMatchObject({ kind: 'wait', detail: expect.stringMatching(/partner/) })
    expect(nextAction(load())).toMatchObject({ kind: 'wait' })
  })

  it('asks the vendor to get the load ready once a truck is assigned', () => {
    expect(nextAction(load({ stage: 'assigned' }))).toEqual({ kind: 'do', label: 'Get the load ready for pickup', to: '/vendor/loads/r1' })
  })

  it('puts a problem before anything else', () => {
    const l = load({ stage: 'delivered', problems: [{ id: 'p', type: 'delay', title: 'Running late', message: '', opened_at: null }] })
    expect(nextAction(l)).toEqual({ kind: 'do', label: 'See what happened', to: '/vendor/loads/r1' })
  })

  it('sends a delivered load to its unpaid invoice, then its proof, and waits for an invoice that is not issued', () => {
    expect(nextAction(load({ stage: 'delivered', invoice: { id: 'i1', invoice_number: 'INV-1', status: 'issued', total: 1, issued_at: null, paid_at: null } })))
      .toEqual({ kind: 'do', label: 'Pay invoice INV-1', to: '/vendor/invoices' })
    expect(nextAction(load({ stage: 'delivered', invoice: { id: 'i1', invoice_number: 'INV-1', status: 'paid', total: 1, issued_at: null, paid_at: null } })))
      .toMatchObject({ kind: 'do', to: '/vendor/loads/r1#proof' })
    expect(nextAction(load({ stage: 'delivered' }))).toMatchObject({ kind: 'wait', detail: 'To issue the invoice' })
  })

  it('offers to post a rejected load again, and has nothing for other closed loads', () => {
    expect(nextAction(load({ stage: 'closed', status: 'rejected', manifest_id: null }))).toEqual({ kind: 'do', label: 'Post it again', to: '/vendor/request' })
    expect(nextAction(load({ stage: 'closed', status: 'cancelled' }))).toEqual({ kind: 'none', label: 'Cancelled' })
    expect(nextAction(load({ stage: 'closed', status: 'cancelled', outcome: 'lost' }))).toEqual({ kind: 'none', label: 'Reported lost' })
  })
})

describe('groupByStage', () => {
  it('follows the order work happens and leaves out empty stages', () => {
    const groups = groupByStage([
      load({ id: 'a', stage: 'closed' }), load({ id: 'b', stage: 'waiting' }), load({ id: 'c', stage: 'on_the_way', created_at: '2026-09-27T00:00:00Z' }),
      load({ id: 'd', stage: 'on_the_way', created_at: '2026-09-28T00:00:00Z' }),
    ])
    expect(groups.map(g => g.stage)).toEqual(['waiting', 'on_the_way', 'closed'])
    expect(groups[0].label).toBe('Waiting for us to accept')
    expect(groups[1].loads.map(l => l.id)).toEqual(['d', 'c'])
  })
})

describe('actionItems', () => {
  it('is empty when nothing needs the vendor', () => {
    expect(actionItems(board({ loads: [load()] }))).toEqual([])
  })

  it('asks for KYC by state: none, pending, rejected with the reason, and tells them when it is in review', () => {
    expect(actionItems(board({ kyc: 'none' }))[0]).toMatchObject({ to: '/vendor/onboarding' })
    expect(actionItems(board({ kyc: 'pending' }))[0]).toMatchObject({ title: 'Finish your KYC', to: '/vendor/company' })
    expect(actionItems(board({ kyc: 'rejected', kycRejectionReason: 'GST certificate is blurry' }))[0]).toMatchObject({ tone: 'danger', detail: 'GST certificate is blurry' })
    expect(actionItems(board({ kyc: 'submitted' }))[0]).toMatchObject({ tone: 'info', to: null })
    expect(actionItems(board({ kyc: null }))).toEqual([])
  })

  it('flags a missing profile location', () => {
    expect(actionItems(board({ locationMissing: true }))[0]).toMatchObject({ id: 'location', to: '/vendor/company' })
    // Nothing to fix on a profile that does not exist yet: setting it up asks for the location
    expect(actionItems(board({ kyc: 'none', locationMissing: true })).map(i => i.id)).toEqual(['kyc'])
  })

  it('names each load with a problem, the first three only', () => {
    const problem = { id: 'p', type: 'delay', title: 'Your goods are running late', message: '', opened_at: null }
    const loads = ['a', 'b', 'c', 'd', 'e'].map(id => load({ id, code: `CM-${id}`, problems: [problem] }))
    const items = actionItems(board({ loads }))
    expect(items.filter(i => i.id.startsWith('problem-') && i.id !== 'problem-more')).toHaveLength(3)
    expect(items.find(i => i.id === 'problem-a')).toMatchObject({ title: 'A problem on CM-a', detail: 'Your goods are running late', to: '/vendor/loads/a' })
    expect(items.find(i => i.id === 'problem-more')?.title).toBe('2 more loads have a problem')
  })

  it('counts unpaid invoices and what they add up to, ignoring paid and void ones', () => {
    const items = actionItems(board({ invoices: [invoice(), invoice({ id: 'i2', total: 1600 }), invoice({ id: 'i3', status: 'paid' }), invoice({ id: 'i4', status: 'void' })] }))
    expect(items).toEqual([expect.objectContaining({ id: 'invoices', title: '2 invoices to pay', detail: expect.stringContaining('₹10,000'), to: '/vendor/invoices' })])
  })

  it('tells the vendor about loads waiting for MargixIndia to accept or assign a truck', () => {
    const items = actionItems(board({ loads: [load({ id: 'a', stage: 'waiting' }), load({ id: 'b', stage: 'waiting' }), load({ id: 'c', stage: 'accepted' })] }))
    expect(items.map(i => i.title)).toEqual(['2 loads are waiting for MargixIndia', '1 load is accepted and waiting for a truck'])
  })

  it('puts the most urgent first', () => {
    const items = actionItems(board({
      kyc: 'pending', locationMissing: true,
      loads: [load({ stage: 'waiting' }), load({ id: 'x', problems: [{ id: 'p', type: 'delay', title: 't', message: '', opened_at: null }] })],
      invoices: [invoice()],
    }))
    expect(items.map(i => i.tone)).toEqual(['danger', 'warning', 'warning', 'warning', 'info'])
  })
})

describe('claimableLoads', () => {
  it('keeps posted loads delivered, part delivered, returned or lost within 7 days', () => {
    const at = (days: number) => new Date(NOW - days * DAY).toISOString()
    const loads = [
      load({ id: 'ok', stage: 'delivered', outcome: 'delivered', delivered_at: at(2) }),
      load({ id: 'partly', stage: 'on_the_way', outcome: 'partly_delivered', delivered_at: at(1) }),
      load({ id: 'old', stage: 'delivered', outcome: 'delivered', delivered_at: at(9) }),
      load({ id: 'moving' }),
      load({ id: 'space', kind: 'space', manifest_id: null, stage: 'delivered', outcome: 'delivered', delivered_at: at(1) }),
    ]
    expect(claimableLoads(loads, NOW).map(l => l.id)).toEqual(['ok', 'partly'])
  })
})

describe('bidNextStep', () => {
  it('opens the load a won bid created, and points a lost or expired bid at the open return trips', () => {
    expect(bidNextStep({ status: 'won', rejection_reason: null }, 's1').cta).toEqual({ label: 'Open the load', to: '/vendor/loads/s1' })
    expect(bidNextStep({ status: 'won', rejection_reason: null }, null).cta).toBeUndefined()
    expect(bidNextStep({ status: 'lost', rejection_reason: null }, null).cta?.to).toBe('#open-return-trips')
    expect(bidNextStep({ status: 'expired', rejection_reason: null }, null).cta?.to).toBe('#open-return-trips')
    expect(bidNextStep({ status: 'pending', rejection_reason: null }, null)).toEqual({ text: 'Waiting on MargixIndia to decide. We will tell you.' })
  })

  it('gives the reason a bid was rejected', () => {
    expect(bidNextStep({ status: 'rejected', rejection_reason: 'Truck is full' }, null).text).toMatch(/Truck is full/)
  })
})

describe('claimStatusText', () => {
  it('says what each status means, with the amounts', () => {
    expect(claimStatusText({ status: 'filed', approved_amount: null, settled_amount: null })).toMatch(/will review/)
    expect(claimStatusText({ status: 'approved', approved_amount: 10000, settled_amount: null })).toBe('Your claim was approved for ₹10,000. Settlement is next.')
    expect(claimStatusText({ status: 'settled', approved_amount: 10000, settled_amount: 9500 })).toBe('Your claim was settled for ₹9,500.')
    expect(claimStatusText({ status: 'rejected', approved_amount: null, settled_amount: null })).toBe('Your claim was not approved.')
  })
})

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(new Date(NOW - 3.5 * DAY).toISOString(), NOW)).toBe(3)
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince(new Date(NOW + DAY).toISOString(), NOW)).toBe(0)
  })
})
