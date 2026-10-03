// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { HsnHit, LoadPayload, ProductRow } from '@/types/load'

const api = vi.hoisted(() => ({
  hsnSearch: vi.fn(),
  hsn: vi.fn(),
  pincode: vi.fn(),
  cities: vi.fn(),
  vehicleClasses: vi.fn(),
  loadAssist: vi.fn(),
  vendorSendOtp: vi.fn(),
  vendorVerifyOtp: vi.fn(),
  myPostedLoads: vi.fn(),
  repostLoad: vi.fn(),
  setSession: vi.fn(),
}))

vi.mock('@/services/api', () => ({
  publicAPI: { hsnSearch: api.hsnSearch, hsn: api.hsn, pincode: api.pincode, cities: api.cities, vehicleClasses: api.vehicleClasses, loadAssist: api.loadAssist },
  authAPI: { vendorSendOtp: api.vendorSendOtp, vendorVerifyOtp: api.vendorVerifyOtp },
  vendorAPI: { myPostedLoads: api.myPostedLoads, repostLoad: api.repostLoad, postLoad: vi.fn(), businessProfile: vi.fn(), saveBusinessProfile: vi.fn() },
}))
vi.mock('@/services/supabase', () => ({ supabase: { auth: { setSession: api.setSession } } }))
// The map picker is not under test here and needs a browser map.
vi.mock('@/components/map/AddressPicker', () => ({
  default: ({ label, value }: { label: string; value: { address: string } | null }) => <div data-testid={label}>{value?.address ?? ''}</div>,
}))

import HsnSearch from './HsnSearch'
import GoodsStep from './GoodsStep'
import HandlingCard from './HandlingCard'
import FreightCard from './FreightCard'
import { CapacityNote } from './TruckCards'
import OtpModal from './OtpModal'
import LoadConfirmation from './LoadConfirmation'
import PostedLoads from './PostedLoads'
import VendorShipmentRequestPage from '@/pages/VendorShipmentRequestPage'
import AddressStep from './AddressStep'
import { applyRowPatch, emptyDraft, emptyRow } from './logic'
import { loadGuestDraft, saveGuestDraft } from '@/utils/guestDraft'
import { useAuthStore } from '@/store/authStore'
import { useOrgStore } from '@/store/orgStore'
import { memoryAuthStorage } from '@/test-utils/authStorage'

const cement: HsnHit = { hsn_code: '2523', description: 'Portland cement', category: 'construction', gst_rates: [18], rate_note: null, is_hazmat: false, is_perishable: false }
const medicine: HsnHit = { hsn_code: '3004', description: 'Pharmaceutical formulations', category: 'pharma', gst_rates: [5, 12], rate_note: '5% or 12% by product', is_hazmat: false, is_perishable: false }

const van = { key: 'v', name: 'Eicher 14 ft', min_t: 3, max_t: 5, best_for: null, notes: null, interstate_ok: true, is_reefer: false, is_open: false, is_tanker: false, sort: 1 }

// Newer Node versions ship their own localStorage that hides jsdom's; use a plain in-memory one so the test is the same everywhere.
const memory = new Map<string, string>()
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)) },
  removeItem: (k: string) => { memory.delete(k) },
  clear: () => memory.clear(),
}
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })

const wrap = (ui: React.ReactNode, at = '/') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}><MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter></QueryClientProvider>
}

beforeEach(() => {
  localStorage.clear()
  Object.values(api).forEach(f => f.mockReset())
  api.hsnSearch.mockImplementation(async (q: string) => (q.includes('cement') ? [cement] : q.includes('medic') ? [medicine] : []))
  api.hsn.mockResolvedValue(null)
  api.pincode.mockResolvedValue(null)
  api.cities.mockResolvedValue([])
  api.vehicleClasses.mockResolvedValue([])
  api.loadAssist.mockRejectedValue(new Error('not asked in this test'))
})
afterEach(() => cleanup())
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo

function Rows({ initial }: { initial?: ProductRow[] }) {
  const [items, setItems] = useState<ProductRow[]>(initial ?? [emptyRow()])
  return (
    <GoodsStep
      items={items} errors={{}}
      onChangeRow={(i, p) => setItems(rows => rows.map((r, n) => (n === i ? applyRowPatch(r, p) : r)))}
      onAdd={() => setItems(rows => [...rows, emptyRow()])}
      onRemove={i => setItems(rows => rows.filter((_, n) => n !== i))}
    />
  )
}

function Single() {
  const [row, setRow] = useState<ProductRow>(emptyRow())
  return <HsnSearch row={row} index={0} onChange={p => setRow(r => ({ ...r, ...p }))} />
}

describe('goods step', () => {
  it('has no remove button on the first row, adds rows, and removes any other row', () => {
    render(<Rows />)
    expect(screen.queryByRole('button', { name: /remove product 1/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add another product/i }))
    fireEvent.click(screen.getByRole('button', { name: /add another product/i }))
    expect(screen.getAllByRole('group', { name: /^product \d/i })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /remove product 1/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /remove product 2/i }))
    expect(screen.getAllByRole('group', { name: /^product \d/i })).toHaveLength(2)
  })

  it('asks for each product once, with its search, quantity and own handling in the same card', () => {
    render(<Rows />)
    expect(screen.getAllByLabelText(/describe your goods/i)).toHaveLength(1)
    const card = screen.getByRole('group', { name: 'Product 1' })
    for (const label of [/describe your goods/i, /^quantity/i, /^unit/i, /^weight/i, /^declared value/i]) expect(within(card).getByLabelText(label)).toBeTruthy()
    // Handling is folded away until the Handling chip is opened
    expect(within(card).queryByLabelText(/^fragile/i)).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /^handling/i }))
    for (const label of [/^fragile/i, /^hazardous/i]) expect(within(card).getByLabelText(label)).toBeTruthy()
  })

  it('fills the weight from a quantity in kg, and lets it be changed', () => {
    render(<Rows />)
    fireEvent.change(screen.getByLabelText(/^unit/i), { target: { value: 'kg' } })
    fireEvent.change(screen.getByLabelText(/^quantity/i), { target: { value: '750' } })
    const weight = screen.getByLabelText(/^weight/i) as HTMLInputElement
    expect(weight.value).toBe('750')
    fireEvent.change(weight, { target: { value: '700' } })
    fireEvent.change(screen.getByLabelText(/^quantity/i), { target: { value: '800' } })
    expect(weight.value).toBe('700')
  })

  it('shows the totals and the e-way counter as values are typed, and the bulk hint at 3 products', () => {
    render(<Rows initial={[emptyRow(), emptyRow(), emptyRow()]} />)
    const weights = screen.getAllByLabelText(/^weight/i)
    const values = screen.getAllByLabelText(/^declared value/i)
    fireEvent.change(weights[0], { target: { value: '12500' } })
    fireEvent.change(weights[1], { target: { value: '8400' } })
    fireEvent.change(values[0], { target: { value: '30000' } })
    expect(screen.getByTestId('total-weight').textContent).toBe('20,900 kg')
    expect(screen.getByTestId('eway-required').textContent).toMatch(/^No e-Way Bill needed/)
    fireEvent.change(values[1], { target: { value: '732500' } })
    expect(screen.getByTestId('total-value').textContent).toBe('₹7,62,500')
    expect(screen.getByTestId('eway-required').textContent).toMatch(/^e-Way Bill needed \(value above/)
    expect(screen.queryByTestId('eway-counter')).toBeNull()
    expect(screen.queryByText(/current declared value/i)).toBeNull()
    expect(screen.getByText(/download a template/i)).toBeTruthy()
  })
})

describe('HSN search', () => {
  it('prefills the code and rate from a pick and leaves both editable, with no lock', async () => {
    render(<Single />)
    fireEvent.change(screen.getByLabelText(/describe your goods/i), { target: { value: 'cement' } })
    const option = await screen.findByRole('option', { name: /2523/ })
    expect(within(option).getByText('18%')).toBeTruthy()
    fireEvent.click(option)
    const code = screen.getByLabelText(/^HSN code/) as HTMLInputElement
    expect(code.value).toBe('2523')
    expect(code.readOnly).toBe(false)
    const rate = screen.getByLabelText(/^GST rate/) as HTMLSelectElement
    expect(rate.value).toBe('18')
    // The code's own rate first, then the other GST 2.0 rates
    expect(Array.from(rate.options).map(o => o.value).filter(Boolean)).toEqual(['18', '0', '0.25', '1.5', '3', '5', '12', '40'])
    fireEvent.change(rate, { target: { value: '12' } })
    expect(rate.value).toBe('12')
  })

  it('looks a changed HSN code up when the box is left, and keeps a chosen rate when the code is unchanged', async () => {
    api.hsn.mockResolvedValue(medicine)
    render(<Single />)
    fireEvent.change(screen.getByLabelText(/describe your goods/i), { target: { value: 'cement' } })
    fireEvent.click(await screen.findByRole('option', { name: /2523/ }))
    fireEvent.change(screen.getByLabelText(/^GST rate/), { target: { value: '12' } })
    const code = screen.getByLabelText(/^HSN code/)
    fireEvent.blur(code)
    expect(api.hsn).not.toHaveBeenCalled()
    expect((screen.getByLabelText(/^GST rate/) as HTMLSelectElement).value).toBe('12')
    fireEvent.change(code, { target: { value: '3004' } })
    fireEvent.blur(code)
    await waitFor(() => expect(api.hsn).toHaveBeenCalledWith('3004'))
    await waitFor(() => expect(screen.getByText('5% or 12% by product')).toBeTruthy())
    const rate = screen.getByLabelText(/^GST rate/) as HTMLSelectElement
    expect(Array.from(rate.options).map(o => o.value).filter(Boolean).slice(0, 2)).toEqual(['5', '12'])
    expect(rate.value).toBe('12')
  })

  it('asks which rate applies for a multi-rate code, with its own rates first', async () => {
    render(<Single />)
    fireEvent.change(screen.getByLabelText(/describe your goods/i), { target: { value: 'medicine' } })
    fireEvent.click(await screen.findByRole('option', { name: /3004/ }))
    const rate = screen.getByLabelText(/^GST rate/) as HTMLSelectElement
    expect(rate.value).toBe('')
    expect(Array.from(rate.options).map(o => o.value).filter(Boolean).slice(0, 2)).toEqual(['5', '12'])
    expect(screen.getByText('5% or 12% by product')).toBeTruthy()
    fireEvent.change(rate, { target: { value: '12' } })
    expect(rate.value).toBe('12')
  })

  it('offers manual HSN entry and the "why" tooltip', () => {
    render(<Single />)
    fireEvent.click(screen.getByRole('button', { name: /enter hsn manually/i }))
    expect(screen.getByLabelText(/^hsn code/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /why is hsn needed/i }))
    expect(screen.getByRole('tooltip').textContent).toMatch(/e-Way Bill and GST invoice/)
  })
})

describe('notes beside a product', () => {
  const multi = { ...emptyRow(), product_name: 'Medicine', hsn_code: '3004', rate_options: [5, 12], gst_rate: null }
  const plain = { ...emptyRow(), product_name: 'Cement', hsn_code: '2523', rate_options: [18], gst_rate: 18, quantity: '10', weight_kg: '500' }
  it('shows the multi-rate note inside that product only, not in a list at the bottom', () => {
    const recs = [{ code: 'multi_rate', severity: 'warn' as const, message: 'HSN 3004 has more than one GST rate (5% OR 12%). Please select one.' }]
    render(<GoodsStep items={[plain, multi]} errors={{}} recommendations={recs} onChangeRow={() => {}} onAdd={() => {}} onRemove={() => {}} />)
    const second = screen.getByRole('group', { name: 'Product 2' })
    expect(within(second).getByText(/HSN 3004 has more than one GST rate/)).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Product 1' })).queryByText(/more than one GST rate/)).toBeNull()
    expect(screen.getAllByText(/more than one GST rate/)).toHaveLength(1)
  })
  it('shows the form\'s own multi-rate note beside the product when the server has not answered', () => {
    render(<GoodsStep items={[multi]} errors={{}} onChangeRow={() => {}} onAdd={() => {}} onRemove={() => {}} />)
    expect(within(screen.getByTestId('product-notes-0')).getByText(/more than one GST rate \(5% \/ 12%\)/)).toBeTruthy()
  })
  it('keeps the note on a folded product summary', () => {
    render(<GoodsStep items={[{ ...multi, gst_rate: 12, quantity: '5', weight_kg: '50' }, emptyRow()]} errors={{}} onChangeRow={() => {}} onAdd={() => {}} onRemove={() => {}} />)
    expect(screen.getByTestId('product-note-0').textContent).toMatch(/You chose 12%/)
  })
})

describe('OTP modal', () => {
  it('sends the code, verifies it, sets the session and reports success', async () => {
    api.vendorSendOtp.mockResolvedValue({ ok: true })
    api.vendorVerifyOtp.mockResolvedValue({ session: { access_token: 'AT', refresh_token: 'RT' } })
    api.setSession.mockResolvedValue({ error: null })
    const onVerified = vi.fn()
    render(wrap(<OtpModal open onClose={() => {}} onVerified={onVerified} emailSignInHref="/login" />))

    fireEvent.change(screen.getByRole('textbox', { name: /^mobile number/i }), { target: { value: '98200 12345' } })
    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'vendor@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send code/i }))
    await screen.findByLabelText(/6-digit code/i)
    expect(api.vendorSendOtp).toHaveBeenCalledWith('+919820012345', 'vendor@example.com')

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }))
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(api.vendorVerifyOtp).toHaveBeenCalledWith('+919820012345', '123456', 'vendor@example.com')
    expect(api.setSession).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' })
  })

  it('shows a wrong code as an error and does not report success', async () => {
    api.vendorSendOtp.mockResolvedValue({ ok: true })
    api.vendorVerifyOtp.mockRejectedValue(new Error('bad code'))
    const onVerified = vi.fn()
    render(wrap(<OtpModal open onClose={() => {}} onVerified={onVerified} emailSignInHref="/login" />))
    fireEvent.change(screen.getByRole('textbox', { name: /^mobile number/i }), { target: { value: '9820012345' } })
    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'vendor@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send code/i }))
    fireEvent.change(await screen.findByLabelText(/6-digit code/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }))
    await screen.findByRole('alert')
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('links to email and password sign-in', () => {
    render(wrap(<OtpModal open onClose={() => {}} onVerified={() => {}} emailSignInHref="/login?next=%2Fvendor%2Frequest%3Fresume%3D1" />))
    const link = screen.getByRole('link', { name: /email and password/i })
    expect(link.getAttribute('href')).toContain('/login')
  })
})

describe('confirmation', () => {
  it('shows the load ID large and copies it with the Copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onAnother = vi.fn()
    render(wrap(
      <LoadConfirmation loadId="abc" loadNumber="MRX-2026-00142" pickupCity="Mumbai" deliveryCity="Delhi" pickupDate="2026-10-05" vehicleName="32 ft SXL" onPostAnother={onAnother} />,
    ))
    expect(screen.getByTestId('load-number').textContent).toBe('MRX-2026-00142')
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('MRX-2026-00142'))
    expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy()
    expect(screen.getByText(/can now book your load/i)).toBeTruthy()
    expect(screen.queryByText(/within 2 hours|quotes/i)).toBeNull()
    expect(screen.queryByText(/matching a verified carrier|auto-generated/i)).toBeNull()
    expect(screen.getByRole('link', { name: /track this load/i }).getAttribute('href')).toBe('/vendor/loads/abc')
    fireEvent.click(screen.getByRole('button', { name: /post another load/i }))
    expect(onAnother).toHaveBeenCalled()
  })
})

describe('confirmation note', () => {
  it('shows the server status note instead of the matching message when the load waits', () => {
    render(wrap(
      <LoadConfirmation loadId="abc" loadNumber="MRX-2026-00143" pickupCity="Mumbai" deliveryCity="Delhi" pickupDate={null} vehicleName="Truck"
        statusNote="Business verification pending. Your load is saved." onPostAnother={() => {}} />,
    ))
    expect(screen.getByText(/business verification pending/i)).toBeTruthy()
    expect(screen.queryByText(/matching a verified carrier/i)).toBeNull()
  })

  it('shows the priority and says companies can book at any price in the range', () => {
    render(wrap(
      <LoadConfirmation loadId="abc" loadNumber="MRX-2026-00144" pickupCity="Mumbai" deliveryCity="Delhi" pickupDate={null} vehicleName="Truck"
        priority="high" priceMin={32000} priceMax={38000} onPostAnother={() => {}} />,
    ))
    expect(screen.getByTestId('confirm-priority').textContent).toBe('High')
    expect(screen.getByTestId('confirm-range').textContent).toBe('₹32,000 – ₹38,000')
    expect(screen.getByText(/can book your load at any price in this range/i)).toBeTruthy()
    expect(screen.queryByText(/quotes/i)).toBeNull()
  })
})

describe('repost', () => {
  it('opens the form with everything filled in and the dates cleared', async () => {
    api.myPostedLoads.mockResolvedValue({
      items: [{ id: 'L1', load_number: 'MRX-2026-00001', status: 'open', pickup_city: 'Mumbai', delivery_city: 'Delhi', pickup_date: '2026-10-05', vehicle_class: 'sxl_32', total_weight_kg: 5000, created_at: null, priority: 'high', price_min_inr: 32000, price_max_inr: 38000 }],
    })
    const payload: Partial<LoadPayload> = {
      items: [{ product_name: 'Cement', hsn_code: '2523', gst_rate: 18, quantity: 100, unit: 'bags', weight_kg: 5000, declared_value: 40000, handling: [], category: null, is_hazmat: false, is_perishable: false }],
      pickup_city: 'Mumbai', pickup_date: '2026-10-05', delivery_city: 'Delhi', vehicle_class: 'sxl_32', load_type: 'ftl', priority: 'low',
    }
    api.repostLoad.mockResolvedValue(payload)
    render(wrap(
      <Routes>
        <Route path="/" element={<PostedLoads />} />
        <Route path="/vendor/request" element={<p>The form</p>} />
      </Routes>,
    ))
    expect((await screen.findByRole('link', { name: 'MRX-2026-00001' })).getAttribute('href')).toBe('/vendor/loads/L1')
    expect(screen.getByText(/High priority/)).toBeTruthy()
    expect(screen.getByTestId('posted-range-L1').textContent).toMatch(/₹32,000 – ₹38,000/)
    fireEvent.click(screen.getByRole('button', { name: /repost/i }))
    await screen.findByText('The form')
    expect(api.repostLoad).toHaveBeenCalledWith('L1')
    const draft = loadGuestDraft<{ pickup_date: string; priority: string; pickup_city: string; reposted_from: string; items: { product_name: string }[] }>('load')
    expect(draft?.pickup_date).toBe('')
    expect(draft?.priority).toBe('low')
    expect(draft?.pickup_city).toBe('Mumbai')
    expect(draft?.items[0].product_name).toBe('Cement')
    expect(draft?.reposted_from).toBe('L1')
  })
})

const goodsDraft = () => ({ ...emptyDraft(), step: 1 })

describe('the form draft', () => {
  it('is saved on every change and comes back after a reload with the same request id', () => {
    saveGuestDraft('load', goodsDraft())
    const first = render(wrap(<VendorShipmentRequestPage />))
    fireEvent.change(screen.getByLabelText(/describe your goods/i), { target: { value: 'cement' } })
    const saved = loadGuestDraft<{ v: number; client_request_id: string; items: { product_name: string }[] }>('load')
    expect(saved?.items[0].product_name).toBe('cement')
    expect(saved?.v).toBe(2)
    expect(saved?.client_request_id).toMatch(/^[0-9a-f-]{36}$/)

    first.unmount()
    render(wrap(<VendorShipmentRequestPage />))
    expect((screen.getByLabelText(/describe your goods/i) as HTMLInputElement).value).toBe('cement')
    expect(loadGuestDraft<{ client_request_id: string }>('load')?.client_request_id).toBe(saved?.client_request_id)
  })

  it('opens on Pickup and delivery and asks for the missing detail instead of moving on', () => {
    render(wrap(<VendorShipmentRequestPage />))
    expect(screen.getByRole('heading', { name: 'Pickup & delivery' })).toBeTruthy()
    expect(screen.queryByLabelText(/describe your goods/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getAllByText(/enter the city/i).length).toBe(2)
    expect(screen.getByText(/who receives the goods/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pickup & delivery' })).toBeTruthy()
  })

  it('moves an old Products draft (step 1) to the Goods step with the product kept', () => {
    saveGuestDraft('load', { ...emptyDraft(), v: undefined, step: 1, items: [{ ...emptyRow(), product_name: 'rice' }] })
    render(wrap(<VendorShipmentRequestPage />))
    expect(screen.getByRole('heading', { name: 'Goods' })).toBeTruthy()
    expect((screen.getByLabelText(/describe your goods/i) as HTMLInputElement).value).toBe('rice')
  })

  it('moves an old Pickup & Delivery draft to Pickup and delivery, and an old Transport draft to Truck and price', () => {
    saveGuestDraft('load', { ...emptyDraft(), v: undefined, step: 2 })
    const first = render(wrap(<VendorShipmentRequestPage />))
    expect(screen.getByRole('heading', { name: 'Pickup & delivery' })).toBeTruthy()
    first.unmount()
    saveGuestDraft('load', { ...emptyDraft(), v: undefined, step: 3 })
    render(wrap(<VendorShipmentRequestPage />))
    expect(screen.getByRole('heading', { name: 'Truck & price' })).toBeTruthy()
  })

  it('shows no pricing, routing or company choice on Truck and price, only the recommended freight', () => {
    saveGuestDraft('load', { ...emptyDraft(), step: 2 })
    render(wrap(<VendorShipmentRequestPage />))
    expect(screen.queryByText(/how do you want to price/i)).toBeNull()
    expect(screen.queryByText(/who can see this load/i)).toBeNull()
    expect(screen.queryByLabelText(/budget|your price/i)).toBeNull()
    expect(screen.queryByRole('radio', { name: /book at my price|get quotes/i })).toBeNull()
    expect(screen.getByTestId('freight-card')).toBeTruthy()
  })

  it('offers Recommend for my goods (default) and Choose myself, which reveals a dropdown', async () => {
    api.vehicleClasses.mockResolvedValue([van, { ...van, key: 'sxl', name: '32 ft SXL', min_t: 14, max_t: 20 }])
    saveGuestDraft('load', { ...emptyDraft(), step: 2, load_type: 'ftl' })
    render(wrap(<VendorShipmentRequestPage />))
    expect((screen.getByRole('radio', { name: /recommend for my goods/i }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('combobox', { name: /vehicle/i })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /choose myself/i }))
    const select = await screen.findByRole('combobox', { name: /vehicle/i }) as HTMLSelectElement
    await waitFor(() => expect(Array.from(select.options).map(o => o.textContent)).toContain('32 ft SXL · 14–20 T'))
    fireEvent.change(select, { target: { value: 'sxl' } })
    expect(loadGuestDraft<{ vehicle_class: string; vehicle_mode: string }>('load')).toMatchObject({ vehicle_class: 'sxl', vehicle_mode: 'manual' })
  })

  it('names the suggested vehicle with its capacity and sends that class in recommend mode', async () => {
    api.vehicleClasses.mockResolvedValue([van])
    api.loadAssist.mockResolvedValue({
      totals: { weight_kg: 4000, declared_value: 0, product_count: 1 }, eway: { required: false, threshold: 50000, reason: '' },
      tax: { basis: 'unknown', pickup_state: null, delivery_state: null, lines: [], by_rate: [], taxable: 0, cgst: 0, sgst: 0, igst: 0, gst_total: 0, grand_total: 0 },
      hazmat_mixed: false, perishable: false, suggested: { load_type: 'ftl', vehicle_class: 'v', capacity_t: 5 },
      estimate: { low: 32000, high: 38000, distance_km: 1400, label: 'Market rate' }, recommendations: [],
    })
    const d = { ...emptyDraft(), step: 2 }
    d.items[0].hsn_code = '2523'
    d.items[0].weight_kg = '4000'
    saveGuestDraft('load', d)
    render(wrap(<VendorShipmentRequestPage />))
    await waitFor(() => expect(screen.getByTestId('vehicle-suggestion').textContent).toBe('Eicher 14 ft · 3–5 T'))
    await waitFor(() => expect(loadGuestDraft<{ vehicle_class: string }>('load')?.vehicle_class).toBe('v'))
    expect(screen.getByTestId('freight-range').textContent).toBe('₹32,000 – ₹38,000')
    expect(screen.getByText(/can book your load at any price in this range/i)).toBeTruthy()
  })

  it('shows Pickup and delivery without the address line, site details or delivery date, and with Priority (Medium by default)', () => {
    render(wrap(<VendorShipmentRequestPage />))
    expect(screen.queryByLabelText(/address line/i)).toBeNull()
    expect(screen.queryByText(/site details|loading dock|access restrictions|need loading help|need unloading help/i)).toBeNull()
    expect(screen.queryByLabelText(/delivery date/i)).toBeNull()
    expect((screen.getByRole('radio', { name: /^medium/i }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Urgent: sent first to the largest logistic networks')).toBeTruthy()
    expect(screen.getByText('Normal booking')).toBeTruthy()
    expect(screen.getByText('Flexible: no rush')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /^high/i }))
    expect(loadGuestDraft<{ priority: string }>('load')?.priority).toBe('high')
  })
})

describe('recommended freight card', () => {
  const assist = (estimate: unknown) => ({ estimate }) as never
  it('shows the range, the distance and the booking line', () => {
    render(<FreightCard assist={assist({ low: 32000, high: 38000, distance_km: 1400, label: 'Market rate' })} />)
    expect(screen.getByTestId('freight-range').textContent).toBe('₹32,000 – ₹38,000')
    expect(screen.getByText(/1,400 km/)).toBeTruthy()
    expect(screen.getByText('Logistic companies can book your load at any price in this range.')).toBeTruthy()
  })
  it('shows a skeleton while it is worked out, and a plain line when there is none', () => {
    const first = render(<FreightCard assist={null} loading />)
    expect(screen.getByTestId('freight-skeleton')).toBeTruthy()
    first.unmount()
    render(<FreightCard assist={assist(null)} />)
    expect(screen.getByText('We will share the range once a logistic company reviews the trip.')).toBeTruthy()
  })
})

describe('handling card', () => {
  it('offers only whole-load options and shows fragile and hazmat from the products as read-only chips', () => {
    const draft = emptyDraft()
    draft.items[0].handling = ['fragile', 'hazmat']
    render(<HandlingCard draft={draft} onChange={() => {}} />)
    expect(screen.queryByRole('checkbox', { name: /fragile/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /hazardous/i })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /do not stack/i })).toBeTruthy()
    const chips = screen.getByTestId('derived-handling').textContent ?? ''
    expect(chips).toMatch(/Fragile/)
    expect(chips).toMatch(/Hazardous/)
  })
})

describe('capacity note', () => {
  const vanInner = { key: 'v', name: 'Eicher 14 ft', min_t: 3, max_t: 5, best_for: null, notes: null, interstate_ok: true, is_reefer: false, is_open: false, is_tanker: false, sort: 1 }
  it('says what the vehicle fits against the load, and warns when the load is heavier', () => {
    const ok = render(<CapacityNote vehicle={vanInner} capacity={5} weightKg={4000} />)
    expect(screen.getByTestId('capacity-note').textContent).toBe('Fits up to 5 t, your load is 4 t.')
    expect(screen.queryByRole('alert')).toBeNull()
    ok.unmount()
    render(<CapacityNote vehicle={vanInner} capacity={5} weightKg={6500} />)
    expect(screen.getByText(/heavier than Eicher 14 ft carries \(5 t\)/)).toBeTruthy()
  })
})

describe('city suggestions', () => {
  it('offers the cities from /public/cities as a list for the city box, which stays free text', async () => {
    api.cities.mockResolvedValue(['Pune', 'Pimpri'])
    const base = emptyDraft()
    const { container } = render(<AddressStep draft={{ ...base, pickup_city: 'P' + 'u' }} onChange={() => {}} errors={{}} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Pickup' })).getByRole('button', { name: /enter the address manually/i }))
    await waitFor(() => expect(api.cities).toHaveBeenCalledWith('Pu'))
    await waitFor(() => expect(container.querySelectorAll('datalist#pickup-city-suggestions option')).toHaveLength(2))
    const box = within(screen.getByRole('group', { name: 'Pickup' })).getByLabelText(/^city/i)
    expect(box.getAttribute('list')).toBe('pickup-city-suggestions')
    expect([...container.querySelectorAll('datalist#pickup-city-suggestions option')].map(o => o.getAttribute('value'))).toEqual(['Pune', 'Pimpri'])
  })
})

describe('the address after a reload', () => {
  it('shows the restored address as a summary line, and the search box when no address was chosen', () => {
    const base = emptyDraft()
    const saved = { ...base, pickup_address: '12 MG Road, Pune', pickup_lat: 18.52, pickup_lng: 73.85, pickup_city: 'Pune', pickup_pincode: '411001' }
    render(<AddressStep draft={saved} onChange={() => {}} errors={{}} />)
    expect(screen.getByTestId('pickup-address-summary').textContent).toMatch(/12 MG Road, Pune/)
    expect(screen.queryByTestId('Search the pickup address')).toBeNull()
    expect(screen.getByTestId('Search the delivery address').textContent).toBe('')
  })
})

describe('staff on the vendor pages', () => {
  beforeEach(() => memoryAuthStorage())
  afterEach(() => { useAuthStore.getState().clearAuth(); useOrgStore.getState().reset() })

  const signInAs = (role: string, tplPartnerId: string | null = null) => {
    useAuthStore.setState({ token: 't', role, tplPartnerId, authInitialized: true })
    useOrgStore.getState().setMemberships([])
  }

  it('tells company staff that posting loads needs a vendor account, and disables Submit Load', async () => {
    signInAs('admin')
    render(wrap(<VendorShipmentRequestPage />, '/vendor/request?resume=1'))
    expect(await screen.findByText("You're signed in as company staff. Posting loads needs a vendor account.")).toBeTruthy()
    const submit = screen.getByRole('button', { name: /submit load/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('shows the same notice for a 3PL partner', async () => {
    signInAs('vendor', 'p1')
    render(wrap(<VendorShipmentRequestPage />, '/vendor/request?resume=1'))
    expect(await screen.findByText("You're signed in as a 3PL partner. Posting loads needs a vendor account.")).toBeTruthy()
  })

  it('shows no notice to a vendor', async () => {
    signInAs('vendor')
    render(wrap(<VendorShipmentRequestPage />, '/vendor/request?resume=1'))
    expect(await screen.findByRole('button', { name: /submit load/i })).toBeTruthy()
    expect(screen.queryByText(/Posting loads needs a vendor account/)).toBeNull()
  })
})
