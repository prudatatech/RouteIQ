import { describe, expect, it } from 'vitest'
import { anchorPanel } from './anchorPanel'

const anchor = { left: 12, right: 52, bottom: 100 }

describe('anchorPanel', () => {
  it('hangs under the button, lined up with its left edge', () => {
    expect(anchorPanel(anchor, 1440, 320, 'start')).toEqual({ top: 108, left: 12, width: 320 })
  })

  it('lines up with the right edge when asked', () => {
    expect(anchorPanel({ left: 1380, right: 1420, bottom: 60 }, 1440, 320, 'end')).toEqual({ top: 68, left: 1100, width: 320 })
  })

  it('stays inside the screen on the left and the right', () => {
    expect(anchorPanel({ left: 0, right: 40, bottom: 0 }, 1440, 320, 'end').left).toBe(8)
    expect(anchorPanel({ left: 1300, right: 1340, bottom: 0 }, 1440, 320, 'start').left).toBe(1112)
  })

  it('shrinks on a phone', () => {
    expect(anchorPanel({ left: 300, right: 340, bottom: 50 }, 375, 320, 'end')).toEqual({ top: 58, left: 20, width: 320 })
    expect(anchorPanel(anchor, 300, 320, 'start')).toEqual({ top: 108, left: 8, width: 284 })
  })
})
