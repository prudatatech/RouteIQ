// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  myOffers: vi.fn(),
  myOrders: vi.fn(),
  accept: vi.fn(),
  vehicles: vi.fn(),
  drivers: vi.fn(),
  rules: vi.fn(),
  saveRules: vi.fn(),
  statements: vi.fn(),
  vehicleClasses: vi.fn(),
  escalations: vi.fn(),
  preview: vi.fn(),
  escalate: vi.fn(),
}))

vi.mock('@/services/api', () => ({
  tplNetworkAPI: { myOffers: api.myOffers, myOrders: api.myOrders, accept: api.accept, escalations: api.escalations, preview: api.preview, escalate: api.escalate },
  tplPortalAPI: { vehicles: api.vehicles, drivers: api.drivers },
  networkAPI: { rules: api.rules, saveRules: api.saveRules, statements: api.statements },
  publicAPI: { vehicleClasses: api.vehicleClasses },
}))
vi.mock('@/services/supabase', () => ({ supabase: { auth: { setSession: vi.fn() } } }))
vi.mock('@/hooks/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => undefined }))

import { ConfirmProvider } from '@/components/ui'
import { AcceptModal, TplOrdersTab } from './TplOrdersTab'
import RulesEditor from './RulesEditor'
import StatementsPanel from './StatementsPanel'
import { deductionsFromRows } from './networkHelpers'
import { EscalationPanel } from './EscalationPanel'
import { companySections } from './grouping'
import type { TplOffer } from '@/services/api'

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ConfirmProvider>{ui}</ConfirmProvider></MemoryRouter>
    </QueryClientProvider>,
  )
}

const offer = (id: string, company: string): TplOffer => ({
  id, partner_id: 'p1', company_name: company, source_type: 'request', request_id: 'r' + id, shipment_id: null, corridor_name: 'DEL-BOM',
  pickup_location: 'Delhi, India', drop_location: 'Mumbai, India', weight_kg: 1000, proposed_price: 20000, status: 'offered',
  pickup_eta: null, decline_reason: null, offered_at: new Date().toISOString(), responded_at: null,
})

beforeEach(() => {
  api.vehicles.mockResolvedValue([{ id: 'v1', plate_number: 'MH01AB1234', vehicle_type: 'truck', capacity_kg: 5000 }])
  api.drivers.mockResolvedValue([{ id: 'd1', full_name: 'Ravi Kumar', phone: '9876543210' }])
  api.vehicleClasses.mockResolvedValue([{ key: 'lcv', name: 'Light truck' }, { key: 'hcv', name: 'Heavy truck' }])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('offers and orders grouped by company', () => {
  it('shows each company name as a section header', async () => {
    api.myOffers.mockResolvedValue({
      items: [offer('1', 'Acme Logistics'), offer('2', 'Bharat Freight'), offer('3', 'Bharat Freight')],
      companies: [
        { org_id: 'o1', name: 'Acme Logistics', items: [offer('1', 'Acme Logistics')] },
        { org_id: 'o2', name: 'Bharat Freight', items: [offer('2', 'Bharat Freight'), offer('3', 'Bharat Freight')] },
      ],
    })
    api.myOrders.mockResolvedValue({ items: [], companies: [] })
    wrap(<TplOrdersTab partnerId="p1" canAccept />)
    const headers = await screen.findAllByRole('heading', { level: 3 })
    expect(headers.map(h => h.textContent)).toEqual(['Acme Logistics (1)', 'Bharat Freight (2)'])
  })

  it('groups a flat answer by each item company name', () => {
    const sections = companySections({ items: [offer('1', 'A'), offer('2', 'B'), offer('3', 'A')], companies: [] })
    expect(sections.map(s => [s.name, s.items.length])).toEqual([['A', 2], ['B', 1]])
  })
})

describe('accept dialog', () => {
  it('needs a vehicle and a driver before it sends anything', async () => {
    wrap(<AcceptModal partnerId="p1" offer={offer('1', 'Acme')} onClose={() => undefined} onDone={() => undefined} />)
    await screen.findByRole('option', { name: /MH01AB1234/ })
    fireEvent.click(screen.getByRole('button', { name: 'Accept load' }))
    expect(await screen.findByText('Choose the vehicle that will carry this load')).toBeTruthy()
    expect(screen.getByText('Choose the driver who will run this trip')).toBeTruthy()
    expect(api.accept).not.toHaveBeenCalled()
  })

  it('sends the chosen vehicle and driver and shows the reason when the server refuses', async () => {
    api.accept.mockRejectedValue({ response: { status: 409, data: { error: 'This vehicle is too small for 6,000 kg' } } })
    wrap(<AcceptModal partnerId="p1" offer={offer('1', 'Acme')} onClose={() => undefined} onDone={() => undefined} />)
    await screen.findByRole('option', { name: /MH01AB1234/ })
    fireEvent.change(screen.getByLabelText(/Vehicle/), { target: { value: 'v1' } })
    fireEvent.change(screen.getByLabelText(/Driver/), { target: { value: 'd1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept load' }))
    expect(await screen.findByText('This vehicle is too small for 6,000 kg')).toBeTruthy()
    expect(api.accept).toHaveBeenCalledWith('1', expect.objectContaining({ vehicle_id: 'v1', driver_id: 'd1' }))
  })
})

describe('rules editor', () => {
  it('sends the rules in the shape the API takes', async () => {
    api.rules.mockResolvedValue({})
    api.saveRules.mockResolvedValue({})
    wrap(<RulesEditor tplId="t1" corridors={[{ id: 'c1', corridor_name: 'DEL-BOM' }]} />)
    fireEvent.click(await screen.findByLabelText('Heavy truck'))
    fireEvent.click(screen.getByLabelText('DEL-BOM'))
    fireEvent.change(screen.getByLabelText(/Lowest rate per km/), { target: { value: '18.5' } })
    fireEvent.click(screen.getByLabelText('Vehicles must have GPS'))
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await waitFor(() => expect(api.saveRules).toHaveBeenCalledTimes(1))
    expect(api.saveRules).toHaveBeenCalledWith('t1', {
      vehicle_classes: ['hcv'], corridor_ids: ['c1'], min_rate_per_km: 18.5, gps_required: true, insurance_required: false,
    })
  })
})

describe('statements', () => {
  it('shows the orders total, the deduction and the balance the server worked out', async () => {
    api.statements.mockResolvedValue([{
      id: 's1', period: '202609', orders_total_paise: 1000000, status: 'issued', issued_at: '2026-10-01T00:00:00Z',
      deductions: [{ label: 'Damaged goods', amount_paise: 50000, reason: 'Two cartons' }], balance_paise: 950000,
    }])
    wrap(<StatementsPanel tplId="t1" />)
    expect(await screen.findByText('September 2026')).toBeTruthy()
    expect(screen.getByText('₹10,000')).toBeTruthy()
    expect(screen.getByText('−₹500')).toBeTruthy()
    expect(screen.getByText('₹9,500')).toBeTruthy()
  })

  it('turns typed rupees into whole paise and rejects incomplete rows', () => {
    expect(deductionsFromRows([{ label: ' Late ', amount: '12.34', reason: 'Two days' }, { label: '', amount: '', reason: '' }]))
      .toEqual([{ label: 'Late', amount_paise: 1234, reason: 'Two days' }])
    expect(deductionsFromRows([{ label: 'Late', amount: '', reason: 'x' }])).toBeNull()
  })
})

describe('escalation to chosen partners', () => {
  it('sends only the ticked partners and lists the excluded ones with reasons', async () => {
    api.escalations.mockResolvedValue({ offers: [], order: null })
    api.preview.mockResolvedValue({
      pickup: 'Delhi', drop: 'Mumbai', distance_km: 1400,
      partners: [
        { partner_id: 'a', company_name: 'Alpha Carriers', corridor_name: 'DEL-BOM', price: 20000, rate: { amount: 20000, unit: 'per_trip' } },
        { partner_id: 'b', company_name: 'Beta Carriers', corridor_name: 'DEL-BOM', price: 21000, rate: { amount: 21000, unit: 'per_trip' } },
      ],
      excluded: [{ partner_id: 'c', name: 'Gamma Carriers', reason: 'Vehicles need GPS' }],
    })
    api.escalate.mockResolvedValue({ created: 1, already_offered: 0, matched: 2 })
    wrap(<EscalationPanel source={{ shipment_id: 's1' }} canEscalate />)
    expect(await screen.findByText(/Vehicles need GPS/)).toBeTruthy()
    fireEvent.click(await screen.findByLabelText('Chosen partners'))
    fireEvent.click(screen.getByLabelText(/Beta Carriers/))
    fireEvent.click(screen.getByRole('button', { name: /Escalate to 3PL partners/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send offers' }))
    await waitFor(() => expect(api.escalate).toHaveBeenCalledTimes(1))
    expect(api.escalate).toHaveBeenCalledWith({ shipment_id: 's1' }, undefined, ['b'])
  })
})
