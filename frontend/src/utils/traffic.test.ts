import { describe, expect, it } from 'vitest'
import { describeIncident } from './traffic'

describe('describeIncident', () => {
  it('names the cause, the road and the delay in minutes', () => {
    expect(describeIncident({ type: 'Accident', road: 'NH48', delay_seconds: 1500 })).toBe('Accident on NH48, +25 min')
  })

  it('leaves out what is not known', () => {
    expect(describeIncident({ type: 'Road works', road: null, delay_seconds: null })).toBe('Road works')
    expect(describeIncident({ type: 'Traffic jam', road: 'NH66', delay_seconds: 30 })).toBe('Traffic jam on NH66')
  })
})
