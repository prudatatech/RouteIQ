// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const api = vi.hoisted(() => ({ verifyRc: vi.fn() }))
vi.mock('@/services/api', () => ({ vehiclesAPI: api }))
// Button comes from the @/components/ui barrel, which also exports NotificationsBell - that
// reaches @/services/supabase at import time, so it needs a stub even though this test never uses it.
vi.mock('@/services/supabase', () => ({ supabase: { auth: {}, removeChannel: vi.fn() }, openChannel: vi.fn() }))

import { VehicleRcStatus } from './VehicleRcStatus'

beforeEach(() => api.verifyRc.mockReset())
afterEach(cleanup)

describe('VehicleRcStatus', () => {
  it('says the RC is checked automatically once saved, for a vehicle that does not exist yet', () => {
    render(<VehicleRcStatus vehicleId={null} />)
    expect(screen.getByText(/checked automatically once this vehicle is saved/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('runs a fresh check and shows what Cashfree returned', async () => {
    api.verifyRc.mockResolvedValue({
      id: 'v1', status: 'valid', rc_number: 'KA06AZ6020', verification_id: 'x', reference_id: '1',
      owner_name: 'Ravi Kumar', rc_status: 'ACTIVE', rc_expiry_date: '15/08/2035',
      insurance_upto: '01/01/2027', pucc_upto: '01/06/2026', permit_valid_upto: null,
      blacklist_status: 'NA', error_message: null,
    })
    render(<VehicleRcStatus vehicleId="veh-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Check RC' }))
    expect(await screen.findByText('RC verified')).toBeTruthy()
    expect(screen.getByText('Ravi Kumar')).toBeTruthy()
    expect(screen.getByText('01/01/2027')).toBeTruthy()
    expect(api.verifyRc).toHaveBeenCalledWith('veh-1')
    expect(screen.queryByText(/Blacklisted/)).toBeNull()
  })

  it('flags a blacklisted vehicle', async () => {
    api.verifyRc.mockResolvedValue({
      id: 'v1', status: 'valid', rc_number: 'KA06AZ6020', verification_id: 'x', reference_id: '1',
      owner_name: null, rc_status: null, rc_expiry_date: null, insurance_upto: null, pucc_upto: null, permit_valid_upto: null,
      blacklist_status: 'ACTIVE', error_message: null,
    })
    render(<VehicleRcStatus vehicleId="veh-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Check RC' }))
    expect(await screen.findByText(/Blacklisted: ACTIVE/)).toBeTruthy()
  })

  it('shows the last known status for an already-verified vehicle before a fresh check', () => {
    render(<VehicleRcStatus vehicleId="veh-1" status="invalid" verifiedAt="2026-10-01T00:00:00Z" />)
    expect(screen.getByText(/RC not found or invalid at the RTO/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Re-check RC' })).toBeTruthy()
  })
})
