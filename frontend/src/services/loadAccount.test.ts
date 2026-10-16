import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => ({ from: vi.fn(), result: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: query.from } }))
import { loadAccount } from './account'

beforeEach(() => {
  query.from.mockReset().mockImplementation((table: string) => {
    const chain = {
      select: () => chain, eq: () => chain, limit: () => chain,
      maybeSingle: () => query.result(table),
    }
    return chain
  })
  query.result.mockReset().mockImplementation(async (table: string) => ({ data: table === 'users' ? { role: 'admin' } : null, error: null }))
})

describe('loadAccount', () => {
  it('shares simultaneous restores but reads fresh data after they finish', async () => {
    const first = loadAccount('u1')
    const second = loadAccount('u1')
    expect(second).toBe(first)
    await expect(first).resolves.toMatchObject({ role: 'admin' })
    expect(query.from).toHaveBeenCalledTimes(3)
    await loadAccount('u1')
    expect(query.from).toHaveBeenCalledTimes(6)
  })

  it('keeps different accounts separate', async () => {
    await Promise.all([loadAccount('u1'), loadAccount('u2')])
    expect(query.from).toHaveBeenCalledTimes(6)
  })

  it('allows another attempt after a database error', async () => {
    query.result.mockResolvedValueOnce({ data: null, error: new Error('timeout') })
    await expect(loadAccount('u1')).rejects.toThrow('timeout')
    await expect(loadAccount('u1')).resolves.toMatchObject({ role: 'admin' })
  })
})
