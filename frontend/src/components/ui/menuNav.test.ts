import { describe, expect, it } from 'vitest'
import { nextMenuIndex } from './menuNav'

describe('nextMenuIndex', () => {
  it('moves down and wraps to the first item', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 3)).toBe(1)
    expect(nextMenuIndex(2, 'ArrowDown', 3)).toBe(0)
  })
  it('moves up and wraps to the last item', () => {
    expect(nextMenuIndex(1, 'ArrowUp', 3)).toBe(0)
    expect(nextMenuIndex(0, 'ArrowUp', 3)).toBe(2)
  })
  it('starts at the first or last item when none is focused', () => {
    expect(nextMenuIndex(-1, 'ArrowDown', 3)).toBe(0)
    expect(nextMenuIndex(-1, 'ArrowUp', 3)).toBe(2)
  })
  it('jumps to the ends with Home and End', () => {
    expect(nextMenuIndex(1, 'Home', 4)).toBe(0)
    expect(nextMenuIndex(1, 'End', 4)).toBe(3)
  })
  it('ignores other keys and empty menus', () => {
    expect(nextMenuIndex(0, 'a', 3)).toBeNull()
    expect(nextMenuIndex(0, 'ArrowDown', 0)).toBeNull()
  })
})
