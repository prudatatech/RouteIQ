import { describe, expect, it } from 'vitest'
import { nextOrderStep, orderStepIndex } from './orderSteps'

describe('nextOrderStep', () => {
  it('gives one next action per open order, in the order the backend allows', () => {
    expect(nextOrderStep('accepted')).toEqual({ status: 'picked_up', label: 'Mark picked up' })
    expect(nextOrderStep('picked_up')).toEqual({ status: 'in_transit', label: 'Mark on the way' })
    expect(nextOrderStep('in_transit')).toEqual({ status: 'delivered', label: 'Mark delivered' })
  })

  it('has nothing to do on a finished or cancelled order', () => {
    expect(nextOrderStep('delivered')).toBeNull()
    expect(nextOrderStep('cancelled')).toBeNull()
  })
})

describe('orderStepIndex', () => {
  it('places an order on the line from accepted to delivered', () => {
    expect(['accepted', 'picked_up', 'in_transit', 'delivered'].map(s => orderStepIndex(s as never))).toEqual([0, 1, 2, 3])
    expect(orderStepIndex('cancelled')).toBe(-1)
  })
})
