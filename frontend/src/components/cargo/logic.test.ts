import { describe, expect, it } from 'vitest'
import {
  buildAction, claimMoveErrors, claimMoves, claimSteps, compareBySla, consignmentActions, consignmentCode, exceptionActions, formatDuration,
  holdCaseFor, hubAgeing, pieceSummary, refKey, refOfShipmentRow, slaState, statusMoves, transferItemCount, transferSteps, validateAction,
} from './logic'
import type { CargoException, ExceptionItem, WhereIsIt } from '@/services/cargo'

const NOW = new Date('2026-09-30T10:00:00Z').getTime()
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString()

const item = (over: Partial<ExceptionItem> = {}): ExceptionItem => ({
  id: 'i1', exception_id: 'e1', shipment_id: 's1', pieces_affected: 4, weight_affected_kg: 100, condition: 'good', note: null, ...over,
})

const kase = (over: Partial<CargoException> = {}) => ({
  status: 'open' as CargoException['status'],
  type: 'vehicle_breakdown' as CargoException['type'],
  vehicle_id: 'v1',
  items: [item()],
  ...over,
})

describe('formatDuration', () => {
  it.each([
    [30_000, 'under 1 min'],
    [45 * 60_000, '45 min'],
    [60 * 60_000, '1 h'],
    [(3 * 60 + 12) * 60_000, '3 h 12 min'],
    [26 * 3_600_000, '1 d 2 h'],
    [48 * 3_600_000, '2 d'],
    [-90 * 60_000, '1 h 30 min'],
  ])('%i ms reads %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('slaState', () => {
  it('counts down while there is more than an hour', () => {
    expect(slaState(inMinutes(192), 'open', NOW)).toEqual({ state: 'ok', msLeft: 192 * 60_000, label: '3 h 12 min left', tone: 'success' })
  })
  it('turns amber in the last hour', () => {
    const s = slaState(inMinutes(40), 'investigating', NOW)
    expect(s.state).toBe('soon')
    expect(s.tone).toBe('warning')
    expect(s.label).toBe('40 min left')
  })
  it('says how long it has been overdue', () => {
    const s = slaState(inMinutes(-25), 'action_planned', NOW)
    expect(s.state).toBe('overdue')
    expect(s.label).toBe('Overdue by 25 min')
    expect(s.msLeft).toBeLessThan(0)
  })
  it('stops once the case is resolved or closed', () => {
    expect(slaState(inMinutes(-600), 'resolved', NOW)).toMatchObject({ state: 'stopped', label: 'Resolved', msLeft: null })
    expect(slaState(inMinutes(-600), 'closed', NOW)).toMatchObject({ state: 'stopped', label: 'Closed' })
  })
  it('handles a case without a deadline', () => {
    expect(slaState(null, 'open', NOW).state).toBe('none')
    expect(slaState('not a date', 'open', NOW).state).toBe('none')
  })
})

describe('compareBySla', () => {
  it('puts overdue cases first, then the nearest deadline, then no deadline, then closed', () => {
    const rows = [
      { id: 'closed', status: 'closed', sla_due_at: inMinutes(-500), created_at: inMinutes(-600) },
      { id: 'none', status: 'open', sla_due_at: null, created_at: inMinutes(-10) },
      { id: 'later', status: 'open', sla_due_at: inMinutes(300), created_at: inMinutes(-10) },
      { id: 'overdue', status: 'open', sla_due_at: inMinutes(-30), created_at: inMinutes(-100) },
      { id: 'soon', status: 'investigating', sla_due_at: inMinutes(20), created_at: inMinutes(-100) },
    ] as (Pick<CargoException, 'sla_due_at' | 'status' | 'created_at'> & { id: string })[]
    expect([...rows].sort(compareBySla).map(r => r.id)).toEqual(['overdue', 'soon', 'later', 'none', 'closed'])
  })
})

describe('exceptionActions', () => {
  it('offers the vehicle plans for a breakdown with cargo on board', () => {
    expect(exceptionActions(kase())).toEqual([
      'transship', 'move_to_hub', 'wait_for_repair', 'continue_after_repair', 'return_to_origin', 'resolve', 'add_note',
    ])
  })
  it('adds write-off and claim for an accident', () => {
    const actions = exceptionActions(kase({ type: 'vehicle_accident' }))
    expect(actions).toContain('write_off')
    expect(actions).toContain('raise_claim')
  })
  it('hides every plan that moves the goods while a transfer is under way', () => {
    expect(exceptionActions(kase({ type: 'vehicle_accident' }), { activeTransfer: true })).toEqual(['write_off', 'raise_claim', 'resolve', 'add_note'])
  })
  it('offers a re-attempt for a refused delivery but no vehicle plans without a vehicle', () => {
    const actions = exceptionActions(kase({ type: 'refused', vehicle_id: null }))
    expect(actions).toContain('reattempt')
    expect(actions).toContain('deliver_with_remarks')
    expect(actions).not.toContain('transship')
    expect(actions).not.toContain('wait_for_repair')
  })
  it('keeps only notes and resolve when no consignment is attached', () => {
    expect(exceptionActions(kase({ type: 'damage', items: [] }))).toEqual(['resolve', 'add_note'])
  })
  it('lets a resolved case get a claim, and a closed case only notes', () => {
    expect(exceptionActions(kase({ status: 'resolved', type: 'damage' }))).toEqual(['raise_claim', 'add_note'])
    expect(exceptionActions(kase({ status: 'resolved', type: 'refused' }))).toEqual(['add_note'])
    expect(exceptionActions(kase({ status: 'closed' }))).toEqual(['add_note'])
  })
})

describe('statusMoves', () => {
  it('walks open → investigating → action planned, and can close from any open state', () => {
    expect(statusMoves('open')).toEqual(['investigating', 'closed'])
    expect(statusMoves('investigating')).toEqual(['action_planned', 'closed'])
    expect(statusMoves('resolved')).toEqual([])
  })
})

describe('validateAction and buildAction', () => {
  it('needs a relief vehicle and a meeting place to transship', () => {
    expect(validateAction('transship', {})).toEqual({ to_vehicle_id: 'Choose the relief vehicle.', meet_address: 'Say where the vehicles meet.' })
    expect(buildAction('transship', { to_vehicle_id: 'v2', meet_address: 'NH19 dhaba', meet_lat: '25.5', meet_lng: '84.9' }))
      .toEqual({ action: 'transship', to_vehicle_id: 'v2', meet_address: 'NH19 dhaba', meet_lat: 25.5, meet_lng: 84.9 })
    expect(buildAction('transship', { to_vehicle_id: 'v2', meet_address: 'NH19 dhaba' })).not.toHaveProperty('meet_lat')
  })
  it('refuses a repair time in the past', () => {
    expect(validateAction('wait_for_repair', { expected_at: inMinutes(-120) }, { now: NOW }).expected_at).toBe('Pick a time in the future.')
    expect(validateAction('wait_for_repair', { expected_at: inMinutes(120) }, { now: NOW })).toEqual({})
  })
  it('keeps a write-off within the pieces on the case', () => {
    expect(validateAction('write_off', { pieces: '0', note: 'x' }).pieces).toBe('Enter a whole number of 1 or more.')
    expect(validateAction('write_off', { pieces: '2.5', note: 'x' }).pieces).toBe('Enter a whole number of 1 or more.')
    expect(validateAction('write_off', { pieces: '9', note: 'x' }, { maxPieces: 4 }).pieces).toBe('The case covers 4 pieces at most.')
    expect(validateAction('write_off', { pieces: '3', note: '' }, { maxPieces: 4 })).toEqual({ note: 'Say why the pieces are written off.' })
    expect(buildAction('write_off', { pieces: '3', note: ' Crushed ' })).toEqual({ action: 'write_off', pieces: 3, note: 'Crushed' })
  })
  it('names the consignment of a write-off or claim when the case has several', () => {
    expect(validateAction('write_off', { pieces: '1', note: 'x' }, { needsRef: true }).ref).toBe('Choose the consignment.')
    expect(buildAction('write_off', { pieces: '1', note: 'x', ref: 'manifest:m1' })).toEqual({ action: 'write_off', pieces: 1, note: 'x', ref: { manifest_id: 'm1' } })
    expect(buildAction('raise_claim', { claim_type: 'loss', claimed_amount: '10', ref: 'shipment:s1' })).toMatchObject({ ref: { shipment_id: 's1' } })
    expect(refKey({ shipment_id: 's1' })).toBe('shipment:s1')
  })
  it('sends the receiver and the remarks for a delivery with remarks', () => {
    expect(validateAction('deliver_with_remarks', { receiver_name: '', note: '' })).toEqual({
      receiver_name: 'Enter who received the goods.', note: 'Write the remarks for the proof of delivery.',
    })
    expect(buildAction('deliver_with_remarks', { receiver_name: ' Anil ', note: '2 cartons crushed', condition: 'damaged_packaging', pieces_damaged: '2', otp: '' }))
      .toEqual({ action: 'deliver_with_remarks', receiver_name: 'Anil', note: '2 cartons crushed', condition: 'damaged_packaging', pieces_damaged: 2 })
  })
  it('sends no note with a return to origin (the action takes none)', () => {
    expect(buildAction('return_to_origin', { note: 'x' })).toEqual({ action: 'return_to_origin' })
  })
  it('needs a positive amount for a claim', () => {
    expect(validateAction('raise_claim', { claim_type: 'damage', claimed_amount: '-5' }).claimed_amount).toBe('Enter an amount above ₹0.')
    expect(buildAction('raise_claim', { claim_type: 'damage', claimed_amount: '12500' })).toEqual({ action: 'raise_claim', claim_type: 'damage', claimed_amount: 12500 })
  })
  it('needs an outcome and a note to resolve', () => {
    expect(validateAction('resolve', { resolution: '', note: '' })).toEqual({ resolution: 'Choose the outcome.', note: 'Add a short note on how it was settled.' })
  })
  it('sends dates as ISO timestamps', () => {
    expect(buildAction('reattempt', { scheduled_for: '2026-10-01T09:30:00Z' })).toEqual({ action: 'reattempt', scheduled_for: '2026-10-01T09:30:00.000Z' })
  })
})

const where = (over: Partial<WhereIsIt> = {}): WhereIsIt => ({
  ref: { shipment_id: 's1' },
  code: 'RTX-00000001',
  status: 'in_transit',
  current_holder: 'vehicle',
  vehicle: { id: 'v1', plate_number: 'BR01AB1234', lat: 25.6, lng: 85.1 },
  depot: null,
  pieces: { total: 10, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: 10 },
  seal_number: null,
  open_exceptions: [],
  delivery_attempts: 0,
  max_delivery_attempts: 3,
  delivery_otp_required: false,
  rto: false,
  ...over,
})

describe('consignmentActions', () => {
  it('lets goods on a moving vehicle be moved, held, taken to a hub or returned', () => {
    expect(consignmentActions(where())).toEqual({
      pickup: false, depart: false, deliver: true,
      raiseException: true, moveToVehicle: true, hold: true, release: false, reattemptOn: null, startReturn: true, hubIn: true, hubOut: false, sendOtp: false,
    })
  })
  it('offers a counted pickup only while the goods are with the sender and a vehicle is planned', () => {
    const planned = where({ status: 'assigned', current_holder: 'consignor', pieces: { total: 10, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: 0 } })
    expect(consignmentActions(planned)).toMatchObject({ pickup: true, depart: false, deliver: false })
    expect(consignmentActions({ ...planned, vehicle: null }).pickup).toBe(false)
    expect(consignmentActions(where({ status: 'scheduled', current_holder: 'consignor' })).pickup).toBe(true)
  })
  it('marks picked-up goods in transit, and delivers only what is still on board and not on a return', () => {
    expect(consignmentActions(where({ status: 'picked_up' }))).toMatchObject({ depart: true, deliver: true })
    expect(consignmentActions(where({ status: 'exception' })).deliver).toBe(true)
    expect(consignmentActions(where({ status: 'returning', rto: true })).deliver).toBe(false)
    expect(consignmentActions(where({ status: 'on_hold' })).deliver).toBe(false)
    expect(consignmentActions(where({ status: 'at_hub', current_holder: 'hub', vehicle: null })).deliver).toBe(false)
  })
  it('offers release and not hold when on hold', () => {
    const a = consignmentActions(where({ status: 'on_hold' }))
    expect(a.hold).toBe(false)
    expect(a.release).toBe(true)
  })
  it('offers hub out, not hub in, at a hub', () => {
    const a = consignmentActions(where({ status: 'at_hub', current_holder: 'hub', vehicle: null, depot: { id: 'd1', name: 'Patna hub' } }))
    expect(a.hubOut).toBe(true)
    expect(a.hubIn).toBe(false)
    expect(a.moveToVehicle).toBe(false)
    expect(a.startReturn).toBe(true)
  })
  it('sends the delivery OTP when out for delivery or when one is required', () => {
    expect(consignmentActions(where({ status: 'out_for_delivery' })).sendOtp).toBe(true)
    expect(consignmentActions(where({ delivery_otp_required: true })).sendOtp).toBe(true)
  })
  it('points a re-attempt at the open refused or undeliverable case', () => {
    const a = consignmentActions(where({
      status: 'partially_delivered',
      open_exceptions: [
        { id: 'x1', code: 'EXC-1', type: 'damage', severity: 'low', status: 'open', sla_due_at: null },
        { id: 'x2', code: 'EXC-2', type: 'refused', severity: 'medium', status: 'investigating', sla_due_at: null },
      ],
    }))
    expect(a.reattemptOn).toBe('x2')
  })
  it('allows nothing but viewing once delivered, and no return before pickup', () => {
    const done = consignmentActions(where({ status: 'delivered', current_holder: 'consignee', vehicle: null }))
    expect(Object.values(done).filter(Boolean)).toEqual([])
    expect(consignmentActions(where({ status: 'assigned', current_holder: 'consignor' })).startReturn).toBe(false)
  })
  it('does not offer a move when nothing is left on board', () => {
    expect(consignmentActions(where({ pieces: { total: 10, delivered: 10, damaged: 0, short: 0, returned: 0, on_board: 0 } })).moveToVehicle).toBe(false)
  })
})

describe('pieceSummary', () => {
  it('splits a partial delivery', () => {
    const s = pieceSummary({ total: 12, delivered: 8, damaged: 1, short: 2, returned: 0, on_board: 2 })
    expect(s.segments.map(x => [x.key, x.value])).toEqual([['delivered', 8], ['on_board', 2], ['short', 2]])
    expect(s.headline).toBe('12 pieces: 8 delivered, 2 on board, 2 short')
    expect(s.damaged).toBe(1)
    expect(s.unaccounted).toBe(0)
    expect(s.overCounted).toBe(false)
  })
  it('works out on board when the backend leaves it out', () => {
    const s = pieceSummary({ total: 10, delivered: 3, damaged: 0, short: 1, returned: 0, on_board: undefined as unknown as number })
    expect(s.segments.find(x => x.key === 'on_board')?.value).toBe(6)
  })
  it('flags counts that do not add up', () => {
    expect(pieceSummary({ total: 5, delivered: 4, damaged: 0, short: 3, returned: 0, on_board: 0 }).overCounted).toBe(true)
    expect(pieceSummary({ total: 10, delivered: 4, damaged: 0, short: 0, returned: 0, on_board: 0 }).unaccounted).toBe(6)
  })
  it('reads well with no counts', () => {
    expect(pieceSummary({ total: null, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: 0 }).headline).toBe('Pieces not counted yet')
    expect(pieceSummary({ total: 1, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: 0 }).headline).toBe('1 piece')
  })
})

describe('transferItemCount', () => {
  it('is clean when every count matches', () => {
    expect(transferItemCount({ pieces_planned: 10, pieces_out: 10, pieces_in: 10 })).toMatchObject({ mismatch: false, gap: 0, note: null })
  })
  it('flags fewer received than handed over', () => {
    expect(transferItemCount({ pieces_planned: 10, pieces_out: 10, pieces_in: 8 })).toMatchObject({ mismatch: true, gap: 2, note: '2 fewer received than handed over' })
  })
  it('flags a handover that differs from the plan before anything is received', () => {
    expect(transferItemCount({ pieces_planned: 10, pieces_out: 9, pieces_in: null }).note).toBe('1 fewer handed over than planned')
    expect(transferItemCount({ pieces_planned: 10, pieces_out: 11, pieces_in: 11 }).note).toBe('1 more handed over than planned')
  })
  it('waits for counts that are not in yet', () => {
    expect(transferItemCount({ pieces_planned: 10, pieces_out: null, pieces_in: null }).mismatch).toBe(false)
  })
})

describe('steps', () => {
  it('walks a transfer through its three steps', () => {
    expect(transferSteps({ status: 'planned' }).map(s => s.state)).toEqual(['current', 'todo', 'todo'])
    expect(transferSteps({ status: 'in_progress' }).map(s => s.state)).toEqual(['done', 'current', 'todo'])
    expect(transferSteps({ status: 'completed' }).map(s => s.state)).toEqual(['done', 'done', 'done'])
    expect(transferSteps({ status: 'cancelled', started_at: '2026-09-30T08:00:00Z' }).map(s => s.state)).toEqual(['done', 'stopped', 'todo'])
  })
  it('walks a claim and stops it on rejection', () => {
    expect(claimSteps('filed').map(s => `${s.key}:${s.state}`)).toEqual(['draft:done', 'filed:current', 'surveyed:todo', 'approved:todo', 'settled:todo'])
    expect(claimSteps('rejected').map(s => `${s.key}:${s.state}`)).toEqual(['draft:done', 'filed:done', 'surveyed:done', 'rejected:stopped'])
    expect(claimSteps('withdrawn', 'filed').map(s => s.key)).toEqual(['draft', 'filed', 'withdrawn'])
  })
  it('offers the next claim moves and checks what they need', () => {
    expect(claimMoves('filed')).toEqual(['surveyed', 'rejected', 'withdrawn'])
    expect(claimMoves('settled')).toEqual([])
    expect(claimMoveErrors('approved', { approved_amount: null })).toEqual(['Enter the approved amount before approving.'])
    expect(claimMoveErrors('filed', { insurer: 'New India Assurance' })).toEqual([])
  })
})

describe('hubAgeing', () => {
  it('grades time at the hub', () => {
    expect(hubAgeing(inMinutes(-5 * 60), NOW)).toMatchObject({ tone: 'neutral', label: '5 h' })
    expect(hubAgeing(inMinutes(-30 * 60), NOW)).toMatchObject({ tone: 'warning', label: '1 d 6 h' })
    expect(hubAgeing(inMinutes(-4 * 24 * 60), NOW)).toMatchObject({ tone: 'danger', label: '4 d' })
    expect(hubAgeing(null, NOW).label).toBe('—')
  })
})

describe('consignment identity', () => {
  it('names a consignment by its tracking id or manifest code', () => {
    expect(consignmentCode({ tracking_id: 'RTX-1001' })).toBe('RTX-1001')
    expect(consignmentCode({ manifest_id: 'abcdef12-3456' })).toBe('CM-ABCDEF12')
  })
  it('turns a shipments-list row into a ref', () => {
    expect(refOfShipmentRow({ id: 'm1', tracking_id: 'CM-M1' })).toEqual({ manifest_id: 'm1' })
    expect(refOfShipmentRow({ id: 's1', tracking_id: 'RTX-1' })).toEqual({ shipment_id: 's1' })
  })
})

describe('holdCaseFor', () => {
  const kase = (id: string, over: Partial<CargoException> = {}) => ({
    id, type: 'vehicle_breakdown' as CargoException['type'], source: 'sos' as CargoException['source'], status: 'open' as CargoException['status'],
    sos_alert_id: null as string | null, maintenance_job_id: null as string | null, created_at: '2026-09-30T10:00:00Z', ...over,
  })
  it('prefers the case that names this alert or job, even when it is not the newest', () => {
    const cases = [
      kase('newer', { created_at: '2026-09-30T12:00:00Z', source: 'maintenance', maintenance_job_id: 'job-2' }),
      kase('mine', { sos_alert_id: 'sos-1' }),
    ]
    expect(holdCaseFor(cases, { sosAlertId: 'sos-1' })?.id).toBe('mine')
    expect(holdCaseFor(cases, { maintenanceJobId: 'job-2' })?.id).toBe('newer')
  })
  it('falls back to the newest open hold case: a second trigger joins the vehicle\'s one case', () => {
    const cases = [kase('route-cancel', { type: 'other', source: 'manual', created_at: '2026-09-30T09:00:00Z' }), kase('sos', { sos_alert_id: 'sos-9' })]
    expect(holdCaseFor(cases, { sosAlertId: 'sos-1' })?.id).toBe('sos')
  })
  it('ignores closed cases and cases that do not hold goods on the vehicle', () => {
    const cases = [
      kase('resolved', { status: 'resolved', sos_alert_id: 'sos-1' }),
      kase('damage', { type: 'damage', source: 'custody' }),
      kase('driver', { source: 'driver' }),
      kase('late', { type: 'delay', source: 'eta' }),
    ]
    expect(holdCaseFor(cases, { sosAlertId: 'sos-1' })).toBeNull()
    expect(holdCaseFor([...cases, kase('planned', { status: 'action_planned', type: 'vehicle_accident' })])?.id).toBe('planned')
  })
})
