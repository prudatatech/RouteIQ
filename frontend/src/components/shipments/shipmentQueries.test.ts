import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { dropShipmentQueries } from './shipmentQueries'

describe('dropShipmentQueries', () => {
  it('removes every query about the shipment, the overview included, and keeps the others', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['shipments', 'overview', 'abc'], { x: 1 })
    qc.setQueryData(['shipment-history', 'abc'], { x: 1 })
    qc.setQueryData(['shipment', 'abc'], { x: 1 })
    qc.setQueryData(['shipments', 'overview', 'other'], { x: 1 })
    qc.setQueryData(['shipments'], [])
    await dropShipmentQueries(qc, 'abc')
    const keys = qc.getQueryCache().getAll().map(q => JSON.stringify(q.queryKey)).sort()
    expect(keys).toEqual([JSON.stringify(['shipments']), JSON.stringify(['shipments', 'overview', 'other'])].sort())
  })
})
