import { describe, expect, it } from 'vitest'
import { nextStep, stageState, stopProgress, type NextStepFacts } from './nextStep'

const base: NextStepFacts = { kind: 'shipment', status: 'created' }
const step = (over: Partial<NextStepFacts>) => nextStep({ ...base, ...over })

describe('nextStep', () => {
  it('a created shipment with no trip needs a vehicle', () => {
    expect(step({})).toMatchObject({ stage: 'dispatch', headline: 'Needs a vehicle', action: { kind: 'assign', label: 'Assign vehicle' }, waitingOn: null })
  })

  it('a shipment open to bids waits on vendors and offers the bids, not an assignment', () => {
    const s = step({ biddingOpen: true })
    expect(s.action).toEqual({ kind: 'open_bids', label: 'See the bids' })
    expect(s.waitingOn).toBe('vendors')
  })

  it('an assigned shipment on a pending trip is planned, not sent', () => {
    expect(step({ status: 'assigned', plate: 'HR55AB1234', trip: { status: 'pending', stopCount: 3, stopsDone: 0 } })).toMatchObject({
      stage: 'dispatch',
      headline: 'Trip planned, not sent',
      action: { kind: 'send', label: 'Send to driver' },
    })
  })

  it('an assigned shipment on a sent trip waits on the driver for the pickup', () => {
    const s = step({ status: 'assigned', plate: 'HR55AB1234', trip: { status: 'active', stopCount: 4, stopsDone: 0 } })
    expect(s).toMatchObject({ stage: 'on_the_road', headline: 'Trip sent. Waiting for pickup by HR55AB1234', waitingOn: 'the driver', action: null })
  })

  it('a shipment in transit says where the truck is on its trip', () => {
    const s = step({ status: 'in_transit', plate: 'HR55AB1234', trip: { status: 'active', stopCount: 4, stopsDone: 1 } })
    expect(s).toMatchObject({ stage: 'on_the_road', headline: 'On the road with HR55AB1234 · stop 2 of 4', waitingOn: 'the driver' })
  })

  it('an open problem outranks the trip and names its case', () => {
    const s = step({ status: 'in_transit', plate: 'HR55AB1234', openProblems: [{ id: 'e1', code: 'EXC-12' }] })
    expect(s).toMatchObject({ tone: 'danger', headline: 'Problem open: EXC-12 · Plan the cargo', action: { kind: 'open_problem', problemId: 'e1' } })
  })

  it('several problems are counted and listed', () => {
    const s = step({ status: 'in_transit', openProblems: [{ id: 'e1', code: 'EXC-1' }, { id: 'e2', code: 'EXC-2' }] })
    expect(s.headline).toBe('2 problems open: EXC-1, EXC-2')
  })

  it('a delivered shipment with no price asks for one', () => {
    expect(step({ status: 'delivered', price: null })).toMatchObject({ stage: 'delivered', headline: 'Delivered, no price', action: { kind: 'set_price', label: 'Set price' } })
    expect(step({ status: 'delivered', price: 0 }).action?.kind).toBe('set_price')
  })

  it('a delivered shipment shows its invoice: unpaid, then paid', () => {
    const unpaid = step({ status: 'delivered', price: 5000, invoice: { status: 'issued', number: 'INV-7' } })
    expect(unpaid).toMatchObject({ stage: 'close_and_bill', headline: 'Invoice INV-7 issued · unpaid', waitingOn: 'payment', action: { kind: 'open_invoice' } })
    const paid = step({ status: 'delivered', price: 5000, invoice: { status: 'paid', number: 'INV-7' } })
    expect(paid).toMatchObject({ tone: 'success', headline: 'Closed. Invoice INV-7 paid', action: null })
  })

  it('a delivered, priced shipment with no invoice waits on finance', () => {
    expect(step({ status: 'delivered', price: 5000 })).toMatchObject({ headline: 'Delivered. Invoice not issued yet', waitingOn: 'finance' })
  })

  it('a failed delivery back with the sender can be assigned again; on the truck it is worked in the cargo panel', () => {
    expect(step({ status: 'exception', holder: 'consignor' }).action).toEqual({ kind: 'assign', label: 'Assign again' })
    expect(step({ status: 'exception', holder: 'vehicle' }).action?.kind).toBe('open_cargo')
  })

  it('a hold shows its reason', () => {
    expect(step({ status: 'on_hold', onHoldReason: 'Road closed' })).toMatchObject({ headline: 'On hold', detail: 'Road closed' })
  })

  it('a hold before pickup stays in dispatch and offers to release the hold', () => {
    expect(step({ status: 'on_hold', holder: 'consignor' })).toMatchObject({ stage: 'dispatch', action: { kind: 'open_cargo', label: 'Release hold' } })
    expect(step({ status: 'on_hold', holder: 'vehicle' })).toMatchObject({ stage: 'on_the_road', action: { label: 'Release or move it' } })
  })

  it('a split master points at its lots', () => {
    const s = step({ status: 'in_transit', isMaster: true, lots: { count: 3, delivered: 1 } })
    expect(s).toMatchObject({ headline: 'Split into 3 lots · 1 delivered', action: { kind: 'open_lots' } })
  })

  it('a vendor load with a truck waits on its driver', () => {
    expect(step({ kind: 'manifest', plate: 'MH12AB1234' })).toMatchObject({ headline: 'Truck assigned: MH12AB1234', waitingOn: 'the driver', action: null })
  })

  it('a cancelled shipment leaves the flow', () => {
    expect(step({ status: 'cancelled' })).toMatchObject({ stage: null, headline: 'Cancelled', action: null })
  })
})

describe('nextStep for a vendor request with no load yet', () => {
  const req = (over: Partial<NextStepFacts>) => nextStep({ kind: 'request', status: 'pending', ...over })

  it('a new request waits for a decision in Requests', () => {
    expect(req({})).toMatchObject({ stage: 'request', headline: 'New request', action: { kind: 'open_request', label: 'Review request' } })
  })

  it('an accepted, priced request needs a vehicle; without a price it needs one first', () => {
    expect(req({ status: 'approved', price: 15000 })).toMatchObject({ stage: 'dispatch', headline: 'Needs a vehicle', detail: 'Accepted at ₹15,000.', action: { kind: 'open_request', label: 'Assign vehicle' } })
    expect(req({ status: 'approved', price: null })).toMatchObject({ stage: 'shipment', headline: 'Accepted, no price', action: { kind: 'open_request', label: 'Set price' } })
  })

  it('a rejected or cancelled request leaves the flow', () => {
    expect(req({ status: 'rejected' })).toMatchObject({ stage: null, action: null })
    expect(req({ status: 'cancelled' })).toMatchObject({ stage: null, headline: 'Cancelled by the vendor' })
  })

  it('a request with partners waits on them', () => {
    expect(req({ status: 'escalated' })).toMatchObject({ waitingOn: '3PL partners' })
  })
})

describe('stopProgress', () => {
  it('counts from the stops already decided and never passes the last stop', () => {
    expect(stopProgress({ stopCount: 4, stopsDone: 0 })).toBe('stop 1 of 4')
    expect(stopProgress({ stopCount: 4, stopsDone: 4 })).toBe('stop 4 of 4')
    expect(stopProgress({ stopCount: 0, stopsDone: 0 })).toBeNull()
    expect(stopProgress(null)).toBeNull()
  })
})

describe('stageState', () => {
  it('marks stages before the current one done', () => {
    expect(stageState('on_the_road', 'request')).toBe('done')
    expect(stageState('on_the_road', 'on_the_road')).toBe('current')
    expect(stageState('on_the_road', 'delivered')).toBe('todo')
    expect(stageState(null, 'request')).toBe('todo')
  })
})
