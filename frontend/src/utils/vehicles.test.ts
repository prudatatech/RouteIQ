import { describe, expect, it } from 'vitest'
import { canReturnToService, isDraftVehicle, isFleetVehicle, isVehicleLive, lastSeenAt } from './vehicles'
import { sosHeadline, sosStatusTone } from './sos'
import { vehicleStatusStyle } from '@/config/mapConfig'
import { statusToLabel, statusToTone } from '@/components/ui/status'

describe('vehicle rules', () => {
  it('treats TEMP- and DRFT- plates as drafts, and drafts and archived vehicles as outside the fleet', () => {
    expect(isDraftVehicle({ plate_number: 'TEMP-AB12CD' })).toBe(true)
    expect(isDraftVehicle({ plate_number: 'drft-1' })).toBe(true)
    expect(isDraftVehicle({ plate_number: 'MH01AB1234', status: 'archived' })).toBe(false)
    expect(isFleetVehicle({ plate_number: 'MH01AB1234', status: 'idle' })).toBe(true)
    expect(isFleetVehicle({ plate_number: 'MH01AB1234', status: 'archived' })).toBe(false)
    expect(isFleetVehicle({ plate_number: 'TEMP-AB12CD', status: 'idle' })).toBe(false)
  })

  it('uses the newer of heartbeat and sync as last seen, and one limit for live', () => {
    const now = Date.parse('2026-09-29T10:00:00Z')
    const v = { last_heartbeat: '2026-09-29T09:00:00Z', last_sync: '2026-09-29T09:58:00Z' }
    expect(lastSeenAt(v)?.toISOString()).toBe('2026-09-29T09:58:00.000Z')
    expect(isVehicleLive(v, 5, now)).toBe(true)
    expect(isVehicleLive({ last_heartbeat: '2026-09-29T09:00:00Z' }, 5, now)).toBe(false)
    expect(isVehicleLive({}, 5, now)).toBe(false)
  })

  it('offers return to service only from maintenance', () => {
    expect(canReturnToService({ status: 'maintenance' })).toBe(true)
    expect(canReturnToService({ status: 'idle' })).toBe(false)
  })
})

describe('SOS display', () => {
  it('colours active as danger, acknowledged as warning and resolved as success', () => {
    expect(sosStatusTone('active')).toBe('danger')
    expect(sosStatusTone('acknowledged')).toBe('warning')
    expect(sosStatusTone('resolved')).toBe('success')
  })

  it('shows type and severity together', () => {
    expect(sosHeadline({ alert_type: 'accident', severity: 'serious' })).toBe('Accident · Injuries reported')
    expect(sosHeadline({ alert_type: 'breakdown' })).toBe('Breakdown')
  })
})

describe('vehicle status colours', () => {
  it('the map takes its colours and names from the shared status map', () => {
    for (const status of ['offline', 'gps_off', 'maintenance', 'idle', 'on_route', 'available', 'archived']) {
      const style = vehicleStatusStyle(status)
      expect(style.label).toBe(statusToLabel(status))
      expect(style.tone).toBe(statusToTone(status))
    }
    expect(vehicleStatusStyle('offline').tone).toBe('neutral')
    expect(vehicleStatusStyle('gps_off').tone).toBe('warning')
    expect(vehicleStatusStyle('maintenance')).toEqual({ label: 'In maintenance', tone: 'warning' })
  })
})
