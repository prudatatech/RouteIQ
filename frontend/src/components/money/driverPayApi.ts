import { api } from '@/services/api'
import type { PayEntriesResponse, PayRate, PayoutInput } from './driverPay'

/** Driver pay calls (staff: admin and superadmin). */
export const driverPayAPI = {
  rates: (history = false) => api.get('/driver-pay/rates', { params: history ? { history: 1 } : undefined }).then(r => r.data as PayRate[]),
  saveRate: (data: { vehicle_type: string; per_trip_amount: number; per_km_amount: number; effective_from: string }) =>
    api.post('/driver-pay/rates', data).then(r => r.data as { repriced_entries: number }),
  withdrawRate: (id: string) => api.delete(`/driver-pay/rates/${id}`).then(r => r.data),
  entries: (params: { status?: string; from?: string; to?: string; rate_missing?: boolean }) =>
    api.get('/driver-pay/entries', { params: { ...params, rate_missing: params.rate_missing ? 1 : undefined } }).then(r => r.data as PayEntriesResponse),
  approve: (ids: string[]) => api.post('/driver-pay/entries/approve', { ids }).then(r => r.data as { approved: string[]; skipped: Array<{ id: string; reason: string }> }),
  adjust: (id: string, data: { amount: number; reason: string }) => api.post(`/driver-pay/entries/${id}/adjust`, data).then(r => r.data),
  voidEntry: (id: string, reason: string) => api.post(`/driver-pay/entries/${id}/void`, { reason }).then(r => r.data),
  pay: (data: PayoutInput) => api.post('/driver-pay/payouts', data).then(r => r.data as { payout: { id: string; amount: number }; entries: number }),
}
