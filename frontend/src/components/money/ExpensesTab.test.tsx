// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfirmProvider } from '@/components/ui'

const financeAPI = vi.hoisted(() => ({ expenses: vi.fn() }))
vi.mock('@/services/api', () => ({ financeAPI }))

vi.mock('@/services/expenseReceipts', () => ({
  openReceipt: vi.fn(), uploadReceipt: vi.fn(), RECEIPT_TYPES: ['application/pdf', 'image/jpeg', 'image/png'],
}))

// @/components/ui's barrel pulls in modules that create a Supabase client at import time (see
// LandingPage.test.tsx for the same issue); CI has no VITE_SUPABASE_URL, unlike a local .env.
vi.mock('@/services/supabase', () => ({ supabase: {}, openChannel: vi.fn() }))

import ExpensesTab from './ExpensesTab'

afterEach(cleanup)

const RANGE = { preset: 'custom' as const, from: '2026-10-01', to: '2026-10-17' }

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <ExpensesTab range={RANGE} />
      </ConfirmProvider>
    </QueryClientProvider>,
  )
}

describe('ExpensesTab total', () => {
  it('shows the server total for the whole filtered range, not just the current page', async () => {
    financeAPI.expenses.mockResolvedValue({
      items: [{ id: 'e1', category: 'fuel', amount: 300, expense_date: '2026-10-17', vehicle_id: null, plate_number: null, note: null, litres: null, receipt_path: null, created_at: '2026-10-17T00:00:00Z' }],
      total: 3, total_amount: 600, limit: 1, offset: 0,
    })
    renderTab()
    expect(await screen.findByText('Total')).toBeTruthy()
    expect(await screen.findByTitle('₹600')).toBeTruthy()
  })

  it('falls back to totaling only what search matches, labelled "Total shown"', async () => {
    financeAPI.expenses.mockResolvedValue({
      items: [
        { id: 'e1', category: 'fuel', amount: 300, expense_date: '2026-10-17', vehicle_id: null, plate_number: 'MH12AB1234', note: null, litres: null, receipt_path: null, created_at: '2026-10-17T00:00:00Z' },
        { id: 'e2', category: 'toll', amount: 200, expense_date: '2026-10-17', vehicle_id: null, plate_number: 'DL01XY9999', note: null, litres: null, receipt_path: null, created_at: '2026-10-17T00:00:00Z' },
      ],
      total: 2, total_amount: 500, limit: 50, offset: 0,
    })
    renderTab()
    const search = await screen.findByLabelText('Search expenses')
    search.dispatchEvent(new Event('focus'))
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(search, { target: { value: 'MH12' } })
    expect(await screen.findByText('Total shown')).toBeTruthy()
    // Only the matching row (₹300) should count once search narrows the page, not the server's ₹500 -
    // the Stat value carries a `title` attribute, unlike the table cell showing the same row's own amount.
    expect(await screen.findByTitle('₹300')).toBeTruthy()
  })
})
