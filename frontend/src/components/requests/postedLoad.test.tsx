// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LoadItem } from '@/types/load'

const api = vi.hoisted(() => ({ load: vi.fn(), vehicleClasses: vi.fn() }))
vi.mock('@/services/api', () => ({
  vendorAPI: { load: api.load },
  publicAPI: { vehicleClasses: api.vehicleClasses },
}))
vi.mock('@/services/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } }))
vi.mock('@/components/tpl/EscalationPanel', () => ({ EscalationPanel: () => null }))
vi.mock('@/components/cargo/VendorLoadCargo', () => ({ default: () => null }))
vi.mock('@/components/load-documents/LoadDocumentsPanel', () => ({ LoadDocumentsPanel: () => null }))
vi.mock('./CustomerProfileEditor', () => ({ CustomerDetailsBlock: () => null }))

import { LoadDrawer } from './RequestDrawers'
import { specialHandlingLabels, taxFromItems, temperatureText } from './postedLoad'
import type { VendorRequest } from './model'

const items: LoadItem[] = [
  { id: 'i1', line_no: 1, product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 20000, declared_value: 700000 },
  { id: 'i2', line_no: 2, product_name: 'Rice', hsn_code: '1006', gst_rate: 5, quantity: 10, unit: 'bags', weight_kg: 500, declared_value: 20000 },
]

describe('special handling labels', () => {
  it('turns the form\'s flags, a list, and old free text into a list of labels', () => {
    expect(specialHandlingLabels({})).toEqual([])
    expect(specialHandlingLabels({ fragile: true })).toEqual(['Fragile'])
    expect(specialHandlingLabels({ fragile: true, do_not_stack: true, odc: false })).toEqual(['Fragile', 'Do not stack'])
    expect(specialHandlingLabels(['hazmat', 'this_side_up'])).toEqual(['Hazardous', 'This side up'])
    expect(specialHandlingLabels('Keep dry')).toEqual(['Keep dry'])
    expect(specialHandlingLabels(null)).toEqual([])
    expect(specialHandlingLabels(undefined)).toEqual([])
  })
})

describe('temperature and GST of a posted load', () => {
  it('says ambient without a range, and chilled or frozen with one', () => {
    expect(temperatureText('ambient', null, null)).toBe('Ambient (no cooling)')
    expect(temperatureText('chilled', 2, 8)).toBe('Chilled, 2 to 8 °C')
    expect(temperatureText('frozen', '-18', '-18')).toBe('Frozen, -18 °C')
    expect(temperatureText(null, null, null)).toBeNull()
    expect(temperatureText(null, 2, 8)).toBe('Controlled, 2 to 8 °C')
  })

  it('sums GST by rate, and splits it by the stored basis', () => {
    const inter = taxFromItems(items, 'inter')
    expect(inter.by_rate).toEqual([{ rate: 5, taxable: 20000, gst: 1000 }, { rate: 18, taxable: 700000, gst: 126000 }])
    expect(inter).toMatchObject({ taxable: 720000, gst_total: 127000, grand_total: 847000, igst: 127000, cgst: 0, sgst: 0, basis: 'inter' })
    expect(taxFromItems(items, 'intra')).toMatchObject({ cgst: 63500, sgst: 63500, igst: 0 })
  })
})

const request = (over: Partial<VendorRequest> & Record<string, unknown> = {}): VendorRequest => ({
  id: 'r1', vendor_id: 'v1', pickup_location: 'Plot 4, Mumbai', pickup_lat: 19, pickup_lng: 72, drop_location: 'Okhla, Delhi', drop_lat: 28, drop_lng: 77,
  required_capacity_kg: 20500, status: 'pending', created_at: '2026-10-01T04:00:00Z', updated_at: null, assigned_vehicle_id: null, cost: null, cost_per_km: null,
  rejection_reason: null, vendor: { company_name: 'Acme Traders', city: 'Thane' },
  metadata: { cargo: { name: 'Cement bags', category: 'Cement bags', hsn: '2523', gstRate: 18, specialHandling: {} } },
  ...over,
} as VendorRequest)

const posted = {
  load_number: 'MRX-2026-00042', load_type: 'ftl', vehicle_class: 'container_32ft_sxl', capacity_t: 22, temp_min_c: null, temp_max_c: null,
  special_handling: ['fragile'], budget_inr: 90000, quote_requested: true, loading_help: true, unloading_help: false,
  pickup_city: 'Mumbai', pickup_address: 'Plot 4, MIDC Andheri', pickup_pincode: '400093', pickup_date: '2026-10-05', pickup_slot: 'morning',
  pickup_contact_name: 'Ravi', pickup_contact_phone: '+919800000000',
  delivery_city: 'Delhi', delivery_address: 'Warehouse 2, Okhla', delivery_pincode: '110020', delivery_date: null,
  delivery_contact_name: 'Asha', delivery_contact_phone: '+919800000001', loading_dock: true, access_restrictions: 'No trucks after 6pm',
  total_weight_kg: 20500, total_declared_value: 720000, tax_basis: 'inter', eway_required: true, hazmat_mixed: false,
}

function drawer(r: VendorRequest) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const noop = () => {}
  return render(
    <QueryClientProvider client={client}><MemoryRouter>
      <LoadDrawer request={r} onClose={noop} busy={false} accepting={false} rejecting={false} onAccept={noop} onReject={noop} onAssign={noop} />
    </MemoryRouter></QueryClientProvider>,
  )
}

beforeEach(() => {
  api.load.mockReset()
  api.vehicleClasses.mockReset()
  api.load.mockResolvedValue({ load: {}, items })
  api.vehicleClasses.mockResolvedValue([{ key: 'container_32ft_sxl', name: 'Container (32 ft / SXL)' }])
})
afterEach(() => cleanup())

describe('the staff load drawer', () => {
  it('opens a newly posted load whose special handling is an object, without crashing', () => {
    expect(() => drawer(request({ metadata: { cargo: { name: 'Cement bags', specialHandling: { fragile: true, do_not_stack: true } } } }))).not.toThrow()
    expect(screen.getByText('Fragile, Do not stack')).toBeTruthy()
  })

  it('opens a load with an empty special handling object and an old load with text', () => {
    expect(() => drawer(request())).not.toThrow()
    expect(screen.queryByText('Special handling')).toBeNull()
    cleanup()
    drawer(request({ metadata: { cargo: { specialHandling: 'Keep dry' } } }))
    expect(screen.getByText('Keep dry')).toBeTruthy()
  })

  it('shows the MRX number in the header and every posted field', async () => {
    drawer(request(posted))
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getAllByText(/MRX-2026-00042/).length).toBeGreaterThanOrEqual(2)
    const section = screen.getByRole('region', { name: /posted load details/i })
    const text = () => section.textContent ?? ''
    await waitFor(() => expect(within(section).getByRole('table', { name: 'Products' })).toBeTruthy())
    for (const expected of [
      'Cement bags', '2523', '18%', '₹7,00,000', '400 bags', 'Rice', '1006',
      'GST summary', 'IGST', 'Needed. The carrier or company adds it after assignment.',
      'Plot 4, MIDC Andheri, Mumbai, 400093', '5 Oct 2026', 'Morning', 'Ravi · +919800000000',
      'Warehouse 2, Okhla, Delhi, 110020', 'Asha · +919800000001', 'No trucks after 6pm',
      'Full truck load (FTL)', 'Container (32 ft / SXL)', '22 t', '₹90,000', 'Fragile', 'Quote requested',
    ]) expect(text(), expected).toContain(expected)
    expect(within(section).getByText('Quote requested').nextSibling?.textContent).toBe('Yes')
  })

  it('shows ambient on a perishable load, and the hazmat note', async () => {
    drawer(request({ ...posted, hazmat_mixed: true, special_handling: [], metadata: { temp_mode: 'ambient', cargo: { specialHandling: {} } } }))
    const section = screen.getByRole('region', { name: /posted load details/i })
    expect(section.textContent).toContain('Ambient (no cooling)')
    expect(section.textContent).toContain('Only hazmat-certified vehicles can carry this load.')
  })

  it('shows no posted section for a load from the older form', () => {
    drawer(request())
    expect(screen.queryByRole('region', { name: /posted load details/i })).toBeNull()
  })
})
