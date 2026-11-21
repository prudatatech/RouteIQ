// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { VehicleRequest } from '@/services/api'

const api = vi.hoisted(() => ({
  list: vi.fn(), count: vi.fn(), approve: vi.fn(), reject: vi.fn(), requestDocumentFixes: vi.fn(),
}))
vi.mock('@/services/api', () => ({ vehicleRequestsAPI: api }))

const channel = vi.hoisted(() => ({ on: vi.fn(), subscribe: vi.fn() }))
channel.on.mockReturnValue(channel)
channel.subscribe.mockReturnValue(channel)
vi.mock('@/services/supabase', () => ({
  supabase: { removeChannel: vi.fn() },
  openChannel: vi.fn(() => channel),
}))

const getKycDocumentUrl = vi.hoisted(() => vi.fn())
vi.mock('@/services/kycDocuments', () => ({ getKycDocumentUrl }))

vi.mock('@/components/ui/DocumentViewerModal', () => ({
  default: ({ isOpen, fileName }: { isOpen: boolean; fileName: string }) => (isOpen ? <div data-testid="viewer">{fileName}</div> : null),
}))

import VehicleRequestsPage from './VehicleRequestsPage'
import { ConfirmProvider } from '@/components/ui'

const request = (over: Partial<VehicleRequest['vehicle']> = {}): VehicleRequest => ({
  vehicle: {
    id: 'veh-1', plate_number: 'MH12AB1234', vehicle_type: 'truck', capacity_kg: 5000,
    rc_number: 'RC-77', rc_document_url: 'vehicles/veh-1/documents/rc_abc.pdf', // the new signed-upload storage path
    insurance_number: 'INS-99', insurance_document_url: 'https://old.example/kyc_documents/legacy/insurance.pdf', // a legacy public URL
    fitness_certificate_number: 'FIT-1', fitness_document_url: null, // never uploaded
    ...over,
  },
  driver: { id: 'd1', full_name: 'Ravi Driver', phone: '+919876543210', email: null },
  photos: [],
  primary_photo_url: null,
  submitted_at: '2026-09-29T08:00:00.000Z',
})

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfirmProvider>
      <MemoryRouter><VehicleRequestsPage /></MemoryRouter>
    </ConfirmProvider>
  </QueryClientProvider>,
)

beforeEach(() => {
  Object.values(api).forEach(m => m.mockReset())
  getKycDocumentUrl.mockReset()
  api.list.mockResolvedValue({ pending: 1, requests: [request()] })
  api.count.mockResolvedValue({ pending: 1 })
})
afterEach(() => cleanup())

describe('VehicleRequestsPage documents', () => {
  it('offers to view a document stored as a signed-upload path, resolving it through getKycDocumentUrl', async () => {
    getKycDocumentUrl.mockResolvedValue('https://signed.example/rc.pdf')
    show()
    const rc = await screen.findByText('RC')
    const card = rc.closest('li') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'View file' }))
    expect(getKycDocumentUrl).toHaveBeenCalledWith('vehicles/veh-1/documents/rc_abc.pdf')
    expect((await screen.findByTestId('viewer')).textContent).toContain('RC')
  })

  it('still opens a legacy public URL through the same resolver', async () => {
    getKycDocumentUrl.mockResolvedValue('https://signed.example/insurance.pdf')
    show()
    const insurance = await screen.findByText('Insurance')
    const card = insurance.closest('li') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'View file' }))
    expect(getKycDocumentUrl).toHaveBeenCalledWith('https://old.example/kyc_documents/legacy/insurance.pdf')
  })

  it('shows "Not uploaded" instead of a view link when the field is genuinely empty', async () => {
    show()
    const fitness = await screen.findByText('Fitness')
    const card = fitness.closest('li') as HTMLElement
    expect(within(card).queryByRole('button', { name: 'View file' })).toBeNull()
    expect(within(card).getByText('Not uploaded')).toBeTruthy()
  })
})
