// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MarketLoad, MarketTab } from '@/types/routing'

const api = vi.hoisted(() => ({
  companies: vi.fn(),
  vehicleClasses: vi.fn(),
  loadQuotes: vi.fn(),
  acceptQuote: vi.fn(),
  market: vi.fn(),
  submitQuote: vi.fn(),
  withdrawQuote: vi.fn(),
  accept: vi.fn(),
}))

vi.mock('@/services/api', () => ({
  publicAPI: { companies: api.companies, vehicleClasses: api.vehicleClasses },
  vendorAPI: { loadQuotes: api.loadQuotes, acceptQuote: api.acceptQuote },
  companyLoadsAPI: { market: api.market, submitQuote: api.submitQuote, withdrawQuote: api.withdrawQuote, accept: api.accept },
}))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import { ConfirmProvider } from '@/components/ui'
import CompanyPicker from '@/components/load-post/CompanyPicker'
import { emptyDraft, toPayload } from '@/components/load-post/logic'
import LoadQuotes from '@/components/vendor/LoadQuotes'
import QuotePanel from './QuotePanel'
import { canAcceptDirect } from './quoteRules'
import LoadMarket from './LoadMarket'
import { useOrgStore } from '@/store/orgStore'

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter><ConfirmProvider>{ui}</ConfirmProvider></MemoryRouter>
    </QueryClientProvider>
  )
}

const marketRow = (over: Partial<MarketLoad> = {}): MarketLoad => ({
  id: 'L1', load_number: 'LD-1001', pickup_city: 'Mumbai', delivery_city: 'Delhi', pickup_date: '2026-10-10',
  weight_kg: 5000, declared_value: 250000, budget_inr: 50000, quote_requested: false, quote_deadline: null, my_quote: null, ...over,
})

beforeEach(() => {
  useOrgStore.setState({ loaded: true, activeOrgId: 'company-a', memberships: [{ org: { id: 'company-a', kind: 'logistic_company', name: 'Company A', status: 'active' }, role: 'owner', app_role: 'admin' }] })
  Object.values(api).forEach(f => f.mockReset())
  api.vehicleClasses.mockResolvedValue([])
})
afterEach(cleanup)

describe('the routing in the payload', () => {
  it('is open by default and sends no company list', () => {
    const p = toPayload(emptyDraft())
    expect(p.routing).toBe('open')
    expect(p.company_ids).toBeUndefined()
  })
  it('is open even when an old draft had chosen companies, with no budget and no quote round', () => {
    const old = { ...emptyDraft(), routing: 'chosen', company_ids: ['a', 'b'], budget_inr: '9000', quote_requested: true } as unknown as ReturnType<typeof emptyDraft>
    const p = toPayload(old)
    expect(p.routing).toBe('open')
    expect(p.company_ids).toBeUndefined()
    expect(p.quote_requested).toBe(false)
    expect(p.budget_inr).toBeNull()
  })
})

describe('CompanyPicker', () => {
  it('lets the vendor pick at most 10 companies', async () => {
    api.companies.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, name: `Company ${String(i).padStart(2, '0')}`, city: 'Mumbai', vehicle_types: [], trips_completed: 100 - i,
    })))
    function Host() {
      const [ids, setIds] = useState<string[]>([])
      return <CompanyPicker pickupCity="Mumbai" deliveryCity="Delhi" selected={ids} onChange={setIds} />
    }
    render(wrap(<Host />))
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes).toHaveLength(12)
    expect(api.companies).toHaveBeenCalledWith({ city: 'Mumbai' })
    expect(api.companies).toHaveBeenCalledWith({ city: 'Delhi' })
    for (const box of boxes.slice(0, 10)) fireEvent.click(box)
    await waitFor(() => expect(screen.getByText(/10 of 10 chosen/)).toBeTruthy())
    expect((boxes[10] as HTMLInputElement).disabled).toBe(true)
    expect((boxes[11] as HTMLInputElement).disabled).toBe(true)
    // Taking one off frees a place
    fireEvent.click(boxes[0])
    await waitFor(() => expect((boxes[10] as HTMLInputElement).disabled).toBe(false))
  })
})

describe('LoadQuotes', () => {
  const quote = { id: 'q1', company_name: 'Swift Logistics', trips_completed: 42, amount_inr: 48000, valid_until: '2026-10-12', vehicle_class: null, pickup_eta: null, notes: 'Can load today', status: 'submitted' as const }

  it('accepts a quote after the vendor confirms', async () => {
    api.loadQuotes.mockResolvedValue({ quotes: [quote], quote_deadline: new Date(Date.now() + 90 * 60_000).toISOString(), quote_requested: true, awarded: null })
    api.acceptQuote.mockResolvedValue({})
    render(wrap(<LoadQuotes loadId="L1" />))
    expect(await screen.findByText('Swift Logistics')).toBeTruthy()
    expect(screen.getByText(/42 trips completed/)).toBeTruthy()
    expect(screen.getByText(/left/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    // Nothing is sent until the dialog is confirmed
    expect(api.acceptQuote).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept quote' }))
    await waitFor(() => expect(api.acceptQuote).toHaveBeenCalledWith('L1', 'q1'))
  })

  it('says who won once the load is awarded', async () => {
    api.loadQuotes.mockResolvedValue({ quotes: [], quote_deadline: null, quote_requested: true, awarded: { company_name: 'Swift Logistics', amount_inr: 48000, quote_id: 'q1' } })
    render(wrap(<LoadQuotes loadId="L1" />))
    expect(await screen.findByText('Awarded to Swift Logistics at ₹48,000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})

describe('QuotePanel direct accept', () => {
  it('follows the rule', () => {
    const base = { status: 'pending', quote_requested: false, budget_inr: 50000 }
    expect(canAcceptDirect(base, false)).toBe(true)
    expect(canAcceptDirect({ ...base, quote_requested: true }, false)).toBe(false)
    expect(canAcceptDirect({ ...base, quote_requested: undefined }, false)).toBe(false)
    expect(canAcceptDirect({ ...base, budget_inr: null }, false)).toBe(false)
    expect(canAcceptDirect({ ...base, status: 'approved' }, false)).toBe(false)
    expect(canAcceptDirect(base, true)).toBe(false)
  })

  it('shows Accept at the budget only when no quote was requested', async () => {
    api.market.mockImplementation((tab: MarketTab) => Promise.resolve(tab === 'new' ? [marketRow({ quote_requested: false })] : []))
    render(wrap(<QuotePanel loadId="L1" status="pending" />))
    expect(await screen.findByRole('button', { name: 'Accept at ₹50,000' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit quote' })).toBeNull()
  })

  const ranged = { priority: 'high' as const, price_min_inr: 32000, price_max_inr: 38000, budget_inr: null, quote_requested: false }
  const openPanel = async () => {
    api.market.mockImplementation((tab: MarketTab) => Promise.resolve(tab === 'new' ? [marketRow(ranged)] : []))
    render(wrap(<QuotePanel loadId="L1" status="pending" />))
    return await screen.findByLabelText(/Your amount/) as HTMLInputElement
  }

  it('shows Urgent and the range, prefills the minimum, and books at that amount', async () => {
    api.accept.mockResolvedValue({})
    const input = await openPanel()
    expect(screen.getByText('Urgent')).toBeTruthy()
    expect(screen.getByTestId('range-line').textContent).toMatch(/₹32,000 – ₹38,000/)
    expect(input.value).toBe('32000')
    expect(screen.queryByRole('button', { name: 'Submit quote' })).toBeNull()
    fireEvent.change(input, { target: { value: '35000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book this load' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Book at ₹35,000' }))
    await waitFor(() => expect(api.accept).toHaveBeenCalledWith('L1', { amount_inr: 35000 }))
  })

  it('refuses an amount outside the range with a clear message and sends nothing', async () => {
    const input = await openPanel()
    for (const bad of ['31999', '38001', '']) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.click(screen.getByRole('button', { name: 'Book this load' }))
      expect(await screen.findByText('Enter an amount between ₹32,000 and ₹38,000.')).toBeTruthy()
    }
    expect(api.accept).not.toHaveBeenCalled()
  })

  it('keeps the old accept at the budget when the load has no range', async () => {
    api.market.mockImplementation((tab: MarketTab) => Promise.resolve(tab === 'new' ? [marketRow({ price_min_inr: null, price_max_inr: null })] : []))
    api.accept.mockResolvedValue({})
    render(wrap(<QuotePanel loadId="L1" status="pending" />))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept at ₹50,000' }))
    fireEvent.click(await screen.findAllByRole('button', { name: 'Accept at ₹50,000' }).then(b => b[b.length - 1]))
    await waitFor(() => expect(api.accept).toHaveBeenCalledWith('L1', {}))
  })

  it('hides it when a quote was requested, and submits the quote', async () => {
    api.market.mockImplementation((tab: MarketTab) => Promise.resolve(tab === 'new' ? [marketRow({ quote_requested: true, quote_deadline: new Date(Date.now() + 3_600_000).toISOString() })] : []))
    api.submitQuote.mockResolvedValue({})
    render(wrap(<QuotePanel loadId="L1" status="pending" />))
    const amount = await screen.findByLabelText(/Your price/)
    expect(screen.queryByRole('button', { name: /Accept at/ })).toBeNull()
    fireEvent.change(amount, { target: { value: '47500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }))
    await waitFor(() => expect(api.submitQuote).toHaveBeenCalledWith('L1', { amount_inr: 47500 }))
  })

  it('shows a Won note once the load is won', async () => {
    api.market.mockImplementation((tab: MarketTab) => Promise.resolve(tab === 'won' ? [marketRow()] : []))
    render(wrap(<QuotePanel loadId="L1" status="approved" />))
    expect(await screen.findByText('Won')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit quote' })).toBeNull()
  })
})

describe('LoadMarket tabs', () => {
  it('loads fresh rows after switching companies instead of reusing another company cache', async () => {
    useOrgStore.setState({ memberships: ['company-a', 'company-b'].map(id => ({ org: { id, kind: 'logistic_company' as const, name: id, status: 'active' }, role: 'owner' as const, app_role: 'admin' })) })
    api.market.mockResolvedValueOnce([marketRow({ load_number: 'LD-A' })]).mockResolvedValueOnce([marketRow({ load_number: 'LD-B' })])
    render(wrap(<LoadMarket onOpen={() => {}} />))
    expect((await screen.findAllByText('LD-A')).length).toBeGreaterThan(0)
    act(() => useOrgStore.getState().setActiveOrg('company-b'))
    expect((await screen.findAllByText('LD-B')).length).toBeGreaterThan(0)
    expect(screen.queryAllByText('LD-A')).toHaveLength(0)
    expect(api.market).toHaveBeenCalledTimes(2)
  })

  it.each(['pending', 'suspended', 'rejected'])('does not request company loads for a %s organisation', status => {
    useOrgStore.setState({ memberships: [{ org: { id: 'company-a', kind: 'logistic_company', name: 'Company A', status }, role: 'owner' }] })
    render(wrap(<LoadMarket onOpen={() => {}} />))
    expect(screen.getByRole('status').textContent).toContain(status)
    expect(api.market).not.toHaveBeenCalled()
  })

  it('does not call company endpoints from the platform or its load drawer', () => {
    useOrgStore.setState({ activeOrgId: 'platform', memberships: [{ org: { id: 'platform', kind: 'platform', name: 'Platform', status: 'active' }, role: 'owner', app_role: 'superadmin' }] })
    render(wrap(<><LoadMarket onOpen={() => {}} /><QuotePanel loadId="L1" status="pending" /></>))
    expect(screen.getByRole('status').textContent).toMatch(/Choose a logistic company/)
    expect(api.market).not.toHaveBeenCalled()
  })

  it('waits for memberships instead of requesting without an organisation', () => {
    useOrgStore.setState({ loaded: false })
    render(wrap(<LoadMarket onOpen={() => {}} />))
    expect(api.market).not.toHaveBeenCalled()
  })

  it('shows the priority (Urgent for high) and the recommended range on the board', async () => {
    api.market.mockResolvedValue([marketRow({ priority: 'high', price_min_inr: 32000, price_max_inr: 38000, quote_requested: false })])
    render(wrap(<LoadMarket onOpen={() => {}} />))
    expect((await screen.findAllByText('Urgent')).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('range-L1')[0].textContent).toBe('₹32,000 – ₹38,000')
    expect(screen.getAllByText('Book in range').length).toBeGreaterThan(0)
  })

  it('asks for the tab that was chosen and opens a row', async () => {
    api.market.mockImplementation((tab: MarketTab) => Promise.resolve(tab === 'quoted' ? [marketRow({ id: 'L2', load_number: 'LD-2002', my_quote: { id: 'q', amount_inr: 45000, valid_until: null, vehicle_class: null, pickup_eta: null, notes: null, status: 'submitted' } })] : [marketRow()]))
    const onOpen = vi.fn()
    render(wrap(<LoadMarket onOpen={onOpen} />))
    expect(await screen.findAllByText('LD-1001')).not.toHaveLength(0)
    expect(api.market).toHaveBeenLastCalledWith('new')
    fireEvent.click(screen.getByRole('tab', { name: 'Quoted' }))
    expect((await screen.findAllByText('LD-2002')).length).toBeGreaterThan(0)
    expect(api.market).toHaveBeenLastCalledWith('quoted')
    expect(screen.getAllByText('₹45,000').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('LD-2002')[0])
    expect(onOpen).toHaveBeenCalledWith('L2')
    for (const t of ['Won', 'Lost']) expect(screen.getByRole('tab', { name: t })).toBeTruthy()
  })
})
