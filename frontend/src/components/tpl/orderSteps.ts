import type { TplOrder } from '@/services/api'

export type OrderUpdate = 'picked_up' | 'in_transit' | 'delivered'

/** The steps of an order as the partner sees them, in the order the backend allows them. */
export const ORDER_STEPS: { status: TplOrder['status']; label: string }[] = [
  { status: 'accepted', label: 'Accepted' },
  { status: 'picked_up', label: 'Picked up' },
  { status: 'in_transit', label: 'On the way' },
  { status: 'delivered', label: 'Delivered' },
]

const NEXT: Partial<Record<TplOrder['status'], { status: OrderUpdate; label: string }>> = {
  accepted: { status: 'picked_up', label: 'Mark picked up' },
  picked_up: { status: 'in_transit', label: 'Mark on the way' },
  in_transit: { status: 'delivered', label: 'Mark delivered' },
}

/** The one thing the partner does next on an order, or null when it is finished or cancelled. */
export function nextOrderStep(status: TplOrder['status']): { status: OrderUpdate; label: string } | null {
  return NEXT[status] ?? null
}

/** Index of the order's current step in ORDER_STEPS, or -1 for a cancelled order. */
export function orderStepIndex(status: TplOrder['status']): number {
  return ORDER_STEPS.findIndex(s => s.status === status)
}
