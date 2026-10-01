import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useConfirm } from '@/components/ui'
import { shipmentsAPI } from '@/services/api'
import { apiErrorMessage } from './format'
import type { ShipmentRow } from './types'

/** Delete a shipment (after a confirmation), for the drawer's and the page's Delete button. */
export function useDeleteShipment(shipment: ShipmentRow | null, onDeleted: () => void) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const mutation = useMutation({
    mutationFn: (id: string) => shipmentsAPI.delete(id),
    onSuccess: (_data, id) => {
      onDeleted()
      // The page being left must not ask for the shipment again: it is gone (404)
      queryClient.removeQueries({ queryKey: ['shipments', 'overview', id] })
      queryClient.removeQueries({ queryKey: ['shipment-history', id] })
      queryClient.removeQueries({ queryKey: ['shipment', id] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success('Shipment deleted')
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not delete the shipment. Try again.')),
  })
  const remove = async () => {
    if (!shipment) return
    const ok = await confirm({
      title: `Delete shipment ${shipment.tracking_id}?`,
      message: 'The shipment, its stops and its history are removed. This cannot be undone.',
      confirmLabel: 'Delete shipment',
      tone: 'danger',
    })
    if (ok) mutation.mutate(shipment.id)
  }
  return { remove, isPending: mutation.isPending }
}
