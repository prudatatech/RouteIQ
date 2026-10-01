import { describe, expect, it } from 'vitest'
import { firstWithWork } from './useTabParam'

describe('firstWithWork', () => {
  it('picks the first tab that has rows', () => {
    expect(firstWithWork(['accept', 'done'] as const, { accept: 0, done: 2 })).toBe('done')
    expect(firstWithWork(['accept', 'done'] as const, { accept: 3, done: 2 })).toBe('accept')
  })
  it('says nothing when every tab is empty or the counts are not loaded', () => {
    expect(firstWithWork(['accept', 'done'] as const, { accept: 0, done: 0 })).toBeNull()
    expect(firstWithWork(['accept', 'done'] as const, {})).toBeNull()
  })
})
