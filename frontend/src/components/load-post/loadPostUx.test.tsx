// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { HsnHit, ProductRow } from '@/types/load'

const api = vi.hoisted(() => ({ hsnSearch: vi.fn(), hsn: vi.fn(), pincode: vi.fn(), cities: vi.fn(), vehicleClasses: vi.fn(), loadAssist: vi.fn() }))
vi.mock('@/services/api', () => ({
  publicAPI: api,
  authAPI: { vendorSendOtp: vi.fn(), vendorVerifyOtp: vi.fn() },
  vendorAPI: { myPostedLoads: vi.fn(), repostLoad: vi.fn(), postLoad: vi.fn(), businessProfile: vi.fn(), saveBusinessProfile: vi.fn() },
}))
vi.mock('@/services/supabase', () => ({ supabase: { auth: { setSession: vi.fn() } } }))
vi.mock('@/components/map/AddressPicker', () => ({
  default: ({ label, value }: { label: string; value: { address: string } | null }) => <div data-testid={label}>{value?.address ?? ''}</div>,
}))

import GoodsStep from './GoodsStep'
import AddressStep from './AddressStep'
import VendorShipmentRequestPage from '@/pages/VendorShipmentRequestPage'
import { applyRowPatch, emptyDraft, emptyRow } from './logic'
import { saveGuestDraft } from '@/utils/guestDraft'

const hit = (code: string, description: string): HsnHit => ({ hsn_code: code, description, category: null, gst_rates: [18], rate_note: null, is_hazmat: false, is_perishable: false })
const HITS = [hit('2523', 'Portland cement'), hit('2524', 'Asbestos cement fibres')]

const memory = new Map<string, string>()
const storage = {
  getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, String(v)) },
  removeItem: (k: string) => { memory.delete(k) }, clear: () => memory.clear(),
}
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })

const scrollTo = vi.fn()
beforeEach(() => {
  memory.clear()
  scrollTo.mockReset()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true })
  api.hsnSearch.mockReset().mockImplementation(async (q: string) => (q.includes('cement') ? HITS : []))
  api.hsn.mockReset().mockResolvedValue(null)
  api.pincode.mockReset().mockResolvedValue(null)
  api.cities.mockReset().mockResolvedValue([])
  api.vehicleClasses.mockReset().mockResolvedValue([])
  api.loadAssist.mockReset().mockRejectedValue(new Error('not asked in this test'))
})
afterEach(() => cleanup())

const done = (name: string): ProductRow => ({ ...emptyRow(), product_name: name, hsn_code: '1006', hsn_locked: true, gst_rate: 5, quantity: '20', weight_kg: '1000', declared_value: '40000' })

function Rows({ initial, errors = {} }: { initial?: ProductRow[]; errors?: Record<string, string> }) {
  const [items, setItems] = useState<ProductRow[]>(initial ?? [emptyRow()])
  return (
    <GoodsStep
      items={items} errors={errors}
      onChangeRow={(i, p) => setItems(rows => rows.map((r, n) => (n === i ? applyRowPatch(r, p) : r)))}
      onAdd={() => setItems(rows => [...rows, emptyRow()])}
      onRemove={i => setItems(rows => rows.filter((_, n) => n !== i))}
    />
  )
}

const box = (n: number) => document.querySelector<HTMLInputElement>(`input[name="product_name_${n}"]`)!
/** The suggestions, once they have arrived (the unit dropdown also has options, so look inside the list). */
const suggestions = async () => {
  const list = await screen.findByRole('listbox')
  await waitFor(() => expect(within(list).queryAllByRole('option').length).toBeGreaterThan(0))
  return within(screen.getByRole('listbox')).getAllByRole('option')
}
const type = (n: number, v: string) => { fireEvent.focus(box(n)); fireEvent.change(box(n), { target: { value: v } }) }

describe('HSN list keyboard', () => {
  it('moves with the arrows, marks the active option, picks with Enter and moves on to the quantity', async () => {
    render(<Rows />)
    type(0, 'cement')
    await suggestions()
    expect(screen.getByText('2 matches')).toBeTruthy()
    const input = box(0)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.getAttribute('aria-activedescendant')).toBe(within(screen.getByRole('listbox')).getAllByRole('option')[1].id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((screen.getByLabelText('HSN code') as HTMLInputElement).value).toBe('2524')
    expect(document.activeElement).toBe(document.querySelector('input[name="quantity_0"]'))
  })

  it('does nothing on Enter before an option is active, and closes with Escape and with Tab', async () => {
    render(<Rows />)
    type(0, 'cement')
    await suggestions()
    fireEvent.keyDown(box(0), { key: 'Enter' })
    expect(screen.queryByLabelText('HSN code')).toBeNull()
    fireEvent.keyDown(box(0), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(box(0), { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(box(0), { key: 'Tab' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows the first 6 of 8 matches with Show all', async () => {
    api.hsnSearch.mockResolvedValue(Array.from({ length: 8 }, (_, n) => hit(`10${n}0`, `Grain ${n}`)))
    render(<Rows />)
    type(0, 'grain')
    await suggestions()
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: /show all 8/i }))
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(8)
  })

  it('scrolls the box under the header when it gets focus, smoothly', () => {
    render(<Rows />)
    fireEvent.focus(box(0))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('does not animate for a person who asked for less motion', () => {
    Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true }), configurable: true, writable: true })
    render(<Rows />)
    fireEvent.focus(box(0))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })
})

describe('several products', () => {
  it('searches product 2 and 3 after product 1 is locked, folds finished ones, and focuses the new search on add', async () => {
    render(<Rows />)
    type(0, 'cement')
    fireEvent.click(await screen.findByRole('option', { name: /2523/ }))
    fireEvent.change(document.querySelector('input[name="quantity_0"]')!, { target: { value: '20' } })
    fireEvent.change(document.querySelector('input[name="weight_kg_0"]')!, { target: { value: '1000' } })

    fireEvent.click(screen.getByRole('button', { name: /add another product/i }))
    expect(box(0)).toBeNull()
    expect(screen.getByTestId('product-summary-0').textContent).toBe('1. cement · HSN 2523 · 18% · 20 bags · 1,000 kg')
    await waitFor(() => expect(document.activeElement).toBe(box(1)))

    type(1, 'cement')
    fireEvent.click(await screen.findByRole('option', { name: /2524/ }))
    expect((screen.getByLabelText('HSN code') as HTMLInputElement).value).toBe('2524')
    fireEvent.change(document.querySelector('input[name="quantity_1"]')!, { target: { value: '5' } })
    fireEvent.change(document.querySelector('input[name="weight_kg_1"]')!, { target: { value: '250' } })

    fireEvent.click(screen.getByRole('button', { name: /add another product/i }))
    await waitFor(() => expect(document.activeElement).toBe(box(2)))
    type(2, 'cement')
    expect((await suggestions()).length).toBe(2)
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
  })

  it('keeps only one suggestion list open at a time', async () => {
    render(<Rows initial={[emptyRow(), emptyRow()]} />)
    type(0, 'cement')
    await suggestions()
    type(1, 'cement')
    await waitFor(() => expect(screen.getAllByRole('listbox')).toHaveLength(1))
    expect(box(0).getAttribute('aria-expanded')).toBe('false')
    expect(box(1).getAttribute('aria-expanded')).toBe('true')
  })

  it('folds a finished product into a summary line with Edit and Remove, and opens it again with Edit', () => {
    render(<Rows initial={[done('Basmati rice'), emptyRow()]} />)
    expect(screen.getByTestId('product-summary-0').textContent).toBe('1. Basmati rice · HSN 1006 · 5% · 20 bags · 1,000 kg · ₹40,000')
    expect(box(0)).toBeNull()
    expect(box(1)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit product 1' }))
    expect(box(0)).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove product 2/i })).toBeTruthy()
  })

  it('opens a finished product that has an error', () => {
    render(<Rows initial={[done('Rice'), done('Wheat'), emptyRow()]} errors={{ gst_rate_1: 'Select the applicable GST rate.' }} />)
    expect(box(0)).toBeNull()
    expect(box(1)).toBeTruthy()
  })

  it('keeps the Handling flags behind a chip, open when a flag is set', () => {
    const flagged = { ...done('Glass'), handling: ['fragile' as const] }
    render(<Rows initial={[flagged]} />)
    expect((screen.getByLabelText(/^fragile/i) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('button', { name: /handling \(1\)/i }).getAttribute('aria-expanded')).toBe('true')
  })
})

describe('step 1 compact', () => {
  const picked = { ...emptyDraft(), pickup_address: '12 MG Road, Pune', pickup_lat: 18.5, pickup_lng: 73.8, pickup_city: 'Pune', pickup_pincode: '411001', pickup_state_name: 'Maharashtra' }

  it('shows an address summary with Edit address, which opens the fields, and Done closes them again', () => {
    render(<AddressStep draft={picked} onChange={() => {}} errors={{}} />)
    const pickup = within(screen.getByRole('group', { name: 'Pickup' }))
    expect(pickup.getByTestId('pickup-address-summary').textContent).toMatch(/12 MG Road, Pune.*Pune · 411001 · Maharashtra/)
    expect(pickup.queryByLabelText(/^address line/i)).toBeNull()
    fireEvent.click(pickup.getByRole('button', { name: /edit address/i }))
    expect(pickup.getByLabelText(/^address line/i)).toBeTruthy()
    expect(pickup.getByLabelText(/^city/i)).toBeTruthy()
    fireEvent.click(pickup.getByRole('button', { name: /^done$/i }))
    expect(pickup.queryByLabelText(/^address line/i)).toBeNull()
  })

  it('shows only the search and a manual link before a place is picked', () => {
    render(<AddressStep draft={emptyDraft()} onChange={() => {}} errors={{}} />)
    const delivery = within(screen.getByRole('group', { name: 'Delivery' }))
    expect(delivery.getByTestId('Search the delivery address')).toBeTruthy()
    expect(delivery.queryByLabelText(/^city/i)).toBeNull()
    fireEvent.click(delivery.getByRole('button', { name: /enter the address manually/i }))
    expect(delivery.getByLabelText(/^address line/i)).toBeTruthy()
  })

  it('opens the address fields by itself when one has an error', () => {
    render(<AddressStep draft={picked} onChange={() => {}} errors={{ pickup_pincode: 'Enter the 6-digit pin code.' }} />)
    expect(within(screen.getByRole('group', { name: 'Pickup' })).getByLabelText(/^pin code/i)).toBeTruthy()
  })

  it('folds the site details away, and opens them when a value is set', () => {
    const first = render(<AddressStep draft={emptyDraft()} onChange={() => {}} errors={{}} />)
    expect(screen.queryByLabelText(/loading dock/i)).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: 'Pickup' })).getByRole('button', { name: /site details/i }))
    expect(screen.getByLabelText(/loading dock/i)).toBeTruthy()
    first.unmount()
    render(<AddressStep draft={{ ...emptyDraft(), unloading_help: true }} onChange={() => {}} errors={{}} />)
    expect((screen.getByLabelText(/need unloading help/i) as HTMLInputElement).checked).toBe(true)
  })
})

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>
)

describe('moving between steps', () => {
  it('scrolls smoothly to the top when the step changes', async () => {
    saveGuestDraft('load', { ...emptyDraft(), step: 1, items: [done('Rice')] })
    render(wrap(<VendorShipmentRequestPage />))
    scrollTo.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await screen.findByRole('heading', { name: 'Truck & price' })
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('focuses the first invalid field when Next is refused, opening its collapsed part', async () => {
    saveGuestDraft('load', { ...emptyDraft(), pickup_address: '12 MG Road', pickup_lat: 18.5, pickup_lng: 73.8, pickup_city: 'Pune' })
    render(wrap(<VendorShipmentRequestPage />))
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await act(async () => {})
    const active = document.activeElement as HTMLElement
    expect(active.getAttribute('aria-invalid')).toBe('true')
    expect(active.getAttribute('autocomplete')).toBe('postal-code')
    expect(screen.getByRole('heading', { name: 'Route & dates' })).toBeTruthy()
  })

  it('shows the compact step line and the sticky action bar', () => {
    render(wrap(<VendorShipmentRequestPage />))
    expect(screen.getByText('Step 1 of 4 · Route & dates')).toBeTruthy()
    expect(screen.getByTestId('step-actions').className).toMatch(/sticky bottom-0/)
  })
})
