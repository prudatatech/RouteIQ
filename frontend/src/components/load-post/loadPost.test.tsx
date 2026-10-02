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
  vehicleClasses: vi.fn(),
  loadAssist: vi.fn(),
  vendorSendOtp: vi.fn(),
  vendorVerifyOtp: vi.fn(),
  myPostedLoads: vi.fn(),
  repostLoad: vi.fn(),
  setSession: vi.fn(),
}))

vi.mock('@/services/api', () => ({
  publicAPI: { hsnSearch: api.hsnSearch, hsn: api.hsn, pincode: api.pincode, vehicleClasses: api.vehicleClasses, loadAssist: api.loadAssist },
  authAPI: { vendorSendOtp: api.vendorSendOtp, vendorVerifyOtp: api.vendorVerifyOtp },
  vendorAPI: { myPostedLoads: api.myPostedLoads, repostLoad: api.repostLoad, postLoad: vi.fn(), businessProfile: vi.fn(), saveBusinessProfile: vi.fn() },
}))
vi.mock('@/services/supabase', () => ({ supabase: { auth: { setSession: api.setSession } } }))
// The map picker is not under test here and needs a browser map.
vi.mock('@/components/map/AddressPicker', () => ({
  default: ({ label, value }: { label: string; value: { address: string } | null }) => <div data-testid={label}>{value?.address ?? ''}</div>,
}))

import HsnSearch from './HsnSearch'
import ProductRows from './ProductRows'
import OtpModal from './OtpModal'
import LoadConfirmation from './LoadConfirmation'
import PostedLoads from './PostedLoads'
import VendorShipmentRequestPage from '@/pages/VendorShipmentRequestPage'
import AddressStep from './AddressStep'
import { emptyDraft, emptyRow } from './logic'
import { loadGuestDraft } from '@/utils/guestDraft'

const cement: HsnHit = { hsn_code: '2523', description: 'Portland cement', category: 'construction', gst_rates: [18], rate_note: null, is_hazmat: false, is_perishable: false }
const medicine: HsnHit = { hsn_code: '3004', description: 'Pharmaceutical formulations', category: 'pharma', gst_rates: [5, 12], rate_note: '5% or 12% by product', is_hazmat: false, is_perishable: false }

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
  api.vehicleClasses.mockResolvedValue([])
  api.loadAssist.mockRejectedValue(new Error('not asked in this test'))
})
afterEach(() => cleanup())

function Rows({ initial }: { initial?: ProductRow[] }) {
  const [items, setItems] = useState<ProductRow[]>(initial ?? [emptyRow()])
  return (
    <ProductRows
      items={items} errors={{}}
      onChangeRow={(i, p) => setItems(rows => rows.map((r, n) => (n === i ? { ...r, ...p } : r)))}
      onAdd={() => setItems(rows => [...rows, emptyRow()])}
      onRemove={i => setItems(rows => rows.filter((_, n) => n !== i))}
    />
  )
}

function Single() {
  const [row, setRow] = useState<ProductRow>(emptyRow())
  return <HsnSearch row={row} index={0} onChange={p => setRow(r => ({ ...r, ...p }))} />
}

describe('product rows', () => {
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

  it('shows the totals and the e-way counter as values are typed, and the bulk hint at 3 products', () => {
    render(<Rows initial={[emptyRow(), emptyRow(), emptyRow()]} />)
    const weights = screen.getAllByLabelText(/^weight/i)
    const values = screen.getAllByLabelText(/^declared value/i)
    fireEvent.change(weights[0], { target: { value: '12500' } })
    fireEvent.change(weights[1], { target: { value: '8400' } })
    fireEvent.change(values[0], { target: { value: '30000' } })
    expect(screen.getByTestId('total-weight').textContent).toBe('20,900 kg')
    expect(screen.getByTestId('eway-required').textContent).toBe('No')
    expect(screen.getByTestId('eway-counter').textContent).toBe('Current declared value: ₹30,000')
    fireEvent.change(values[1], { target: { value: '732500' } })
    expect(screen.getByTestId('total-value').textContent).toBe('₹7,62,500')
    expect(screen.getByTestId('eway-required').textContent).toBe('Yes')
    expect(screen.getByTestId('eway-counter').textContent).toMatch(/e-Way Bill will be required/)
    expect(screen.getByText(/download a template/i)).toBeTruthy()
  })
})

describe('HSN search', () => {
  it('locks the code and rate when a suggestion is picked', async () => {
    render(<Single />)
    fireEvent.change(screen.getByLabelText(/describe your goods/i), { target: { value: 'cement' } })
    const option = await screen.findByRole('option', { name: /2523/ })
    expect(within(option).getByText('18%')).toBeTruthy()
    fireEvent.click(within(option).getByRole('button'))
    const code = screen.getByLabelText('HSN code') as HTMLInputElement
    expect(code.value).toBe('2523')
    expect(code.readOnly).toBe(true)
    expect((screen.getByLabelText('GST rate') as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByLabelText(/select applicable gst rate/i)).toBeNull()
  })

  it('asks which rate applies for a multi-rate code, limited to its valid rates', async () => {
    render(<Single />)
    fireEvent.change(screen.getByLabelText(/describe your goods/i), { target: { value: 'medicine' } })
    fireEvent.click(within(await screen.findByRole('option', { name: /3004/ })).getByRole('button'))
    const rate = screen.getByLabelText(/select applicable gst rate/i) as HTMLSelectElement
    expect(Array.from(rate.options).map(o => o.value).filter(Boolean)).toEqual(['5', '12'])
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

describe('OTP modal', () => {
  it('sends the code, verifies it, sets the session and reports success', async () => {
    api.vendorSendOtp.mockResolvedValue({ ok: true })
    api.vendorVerifyOtp.mockResolvedValue({ session: { access_token: 'AT', refresh_token: 'RT' } })
    api.setSession.mockResolvedValue({ error: null })
    const onVerified = vi.fn()
    render(wrap(<OtpModal open onClose={() => {}} onVerified={onVerified} emailSignInHref="/login?as=vendor" />))

    fireEvent.change(screen.getByRole('textbox', { name: /^mobile number/i }), { target: { value: '98200 12345' } })
    fireEvent.click(screen.getByRole('button', { name: /send code/i }))
    await screen.findByLabelText(/6-digit code/i)
    expect(api.vendorSendOtp).toHaveBeenCalledWith('+919820012345')

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }))
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(api.vendorVerifyOtp).toHaveBeenCalledWith('+919820012345', '123456')
    expect(api.setSession).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' })
  })

  it('shows a wrong code as an error and does not report success', async () => {
    api.vendorSendOtp.mockResolvedValue({ ok: true })
    api.vendorVerifyOtp.mockRejectedValue(new Error('bad code'))
    const onVerified = vi.fn()
    render(wrap(<OtpModal open onClose={() => {}} onVerified={onVerified} emailSignInHref="/login?as=vendor" />))
    fireEvent.change(screen.getByRole('textbox', { name: /^mobile number/i }), { target: { value: '9820012345' } })
    fireEvent.click(screen.getByRole('button', { name: /send code/i }))
    fireEvent.change(await screen.findByLabelText(/6-digit code/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }))
    await screen.findByRole('alert')
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('links to email and password sign-in', () => {
    render(wrap(<OtpModal open onClose={() => {}} onVerified={() => {}} emailSignInHref="/login?as=vendor&next=%2Fvendor%2Frequest%3Fresume%3D1" />))
    const link = screen.getByRole('link', { name: /email and password/i })
    expect(link.getAttribute('href')).toContain('/login?as=vendor')
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
    expect(screen.getByText(/matching a verified carrier/i)).toBeTruthy()
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
})

describe('repost', () => {
  it('opens the form with everything filled in and the dates cleared', async () => {
    api.myPostedLoads.mockResolvedValue({
      items: [{ id: 'L1', load_number: 'MRX-2026-00001', status: 'open', pickup_city: 'Mumbai', delivery_city: 'Delhi', pickup_date: '2026-10-05', vehicle_class: 'sxl_32', total_weight_kg: 5000, created_at: null }],
    })
    const payload: Partial<LoadPayload> = {
      items: [{ product_name: 'Cement', hsn_code: '2523', gst_rate: 18, quantity: 100, unit: 'bags', weight_kg: 5000, declared_value: 40000, handling: [], category: null, is_hazmat: false, is_perishable: false }],
      pickup_city: 'Mumbai', pickup_date: '2026-10-05', delivery_city: 'Delhi', delivery_date: '2026-10-09', vehicle_class: 'sxl_32', load_type: 'ftl',
    }
    api.repostLoad.mockResolvedValue(payload)
    render(wrap(
      <Routes>
        <Route path="/" element={<PostedLoads />} />
        <Route path="/vendor/request" element={<p>The form</p>} />
      </Routes>,
    ))
    expect((await screen.findByRole('link', { name: 'MRX-2026-00001' })).getAttribute('href')).toBe('/vendor/loads/L1')
    fireEvent.click(screen.getByRole('button', { name: /repost/i }))
    await screen.findByText('The form')
    expect(api.repostLoad).toHaveBeenCalledWith('L1')
    const draft = loadGuestDraft<{ pickup_date: string; delivery_date: string; pickup_city: string; reposted_from: string; items: { product_name: string }[] }>('load')
    expect(draft?.pickup_date).toBe('')
    expect(draft?.delivery_date).toBe('')
    expect(draft?.pickup_city).toBe('Mumbai')
    expect(draft?.items[0].product_name).toBe('Cement')
    expect(draft?.reposted_from).toBe('L1')
  })
})

describe('the form draft', () => {
  it('is saved on every change and comes back after a reload with the same request id', () => {
    const first = render(wrap(<VendorShipmentRequestPage />))
    const goods = screen.getByLabelText(/describe your goods/i)
    fireEvent.change(goods, { target: { value: 'cement' } })
    const saved = loadGuestDraft<{ client_request_id: string; items: { product_name: string }[] }>('load')
    expect(saved?.items[0].product_name).toBe('cement')
    expect(saved?.client_request_id).toMatch(/^[0-9a-f-]{36}$/)

    first.unmount()
    render(wrap(<VendorShipmentRequestPage />))
    expect((screen.getByLabelText(/describe your goods/i) as HTMLInputElement).value).toBe('cement')
    expect(loadGuestDraft<{ client_request_id: string }>('load')?.client_request_id).toBe(saved?.client_request_id)
  })

  it('asks for the missing detail instead of moving on', () => {
    render(wrap(<VendorShipmentRequestPage />))
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getByText(/describe your goods \(at least 3 characters\)/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Goods & HSN' })).toBeTruthy()
  })
})

describe('the address picker after a reload', () => {
  it('shows the restored place from the saved draft, and nothing when no place was chosen', () => {
    const base = emptyDraft()
    const saved = { ...base, pickup_address: '12 MG Road, Pune', pickup_lat: 18.52, pickup_lng: 73.85 }
    const first = render(<AddressStep draft={saved} onChange={() => {}} errors={{}} />)
    expect(screen.getByTestId('Search the pickup address').textContent).toBe('12 MG Road, Pune')
    expect(screen.getByTestId('Search the delivery address').textContent).toBe('')
    first.unmount()
    render(<AddressStep draft={{ ...base, pickup_address: 'typed only' }} onChange={() => {}} errors={{}} />)
    expect(screen.getByTestId('Search the pickup address').textContent).toBe('')
  })
})
