// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const stats = vi.hoisted(() => vi.fn())
vi.mock('@/services/api', () => ({ publicAPI: { stats } }))

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo

import LandingPage from './LandingPage'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('LandingPage', () => {
  it('shows the hero, the real how-it-works steps, and every audience card', () => {
    stats.mockResolvedValue({ vehicles: 0, deliveries_completed: 0, active_partners: 0, cities_served: 0 })
    renderPage()
    expect(screen.getByRole('heading', { name: /freight operations, capacity and tracking/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeTruthy()
    expect(screen.getAllByText('Post a load').length).toBeGreaterThan(0)
    expect(screen.getByText('A company takes it')).toBeTruthy()
    expect(screen.getByText('Track to delivery')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Operations teams' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Vendors' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '3PL partners' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Customers' })).toBeTruthy()
  })

  it('leaves out the live-numbers strip when every stat is zero', () => {
    stats.mockResolvedValue({ vehicles: 0, deliveries_completed: 0, active_partners: 0, cities_served: 0 })
    renderPage()
    expect(screen.queryByLabelText('Platform in numbers')).toBeNull()
  })
})
