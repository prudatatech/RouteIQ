import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Gavel, Truck } from 'lucide-react'
import { shipmentsAPI } from '@/services/api'
import { Alert, Button, useConfirm } from '@/components/ui'
import { errorMessage, formatRupees, formatKg } from '@/utils/display'
import OpenWindowModal from './OpenWindowModal'
import { backhaulKeys, type BackhaulVehicle } from './data'

/**
 * What staff can do once a load (or a pooled run) fits a truck: put the load(s) on that truck, or offer the
 * truck's space to vendors in a capacity bidding window (at the suggested price when there is one).
 */
export default function LoadActions({ loads, vehicle, suggestedPrice, onAssigned }: {
  /** The load or loads to put on the truck. */
  loads: { id: string; tracking_id: string; weight_kg: number | null }[]
  /** Null when the space was typed in and no vehicle was chosen: nothing can be assigned then. */
  vehicle: BackhaulVehicle | null
  /** A suggested price for the load, offered as the window's minimum bid. */
  suggestedPrice?: number | null
  onAssigned?: () => void
}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [windowOpen, setWindowOpen] = useState(false)

  const assign = useMutation({
    mutationFn: async () => {
      const done: string[] = []
      for (const load of loads) {
        try {
          await shipmentsAPI.assignDriver(load.id, vehicle!.id)
          done.push(load.tracking_id)
        } catch (err) {
          throw new Error(`${load.tracking_id}: ${errorMessage(err, 'could not be assigned')}${done.length ? ` (${done.join(', ')} assigned before it)` : ''}`)
        }
      }
      return done.length
    },
    onSuccess: count => {
      toast.success(`${count === 1 ? 'Load' : `${count} loads`} assigned to ${vehicle!.plate_number}.`)
      onAssigned?.()
    },
    onError: err => toast.error(err instanceof Error ? err.message : 'We could not assign the load. Try again.'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: backhaulKeys.openLoads })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
    },
  })

  const askAssign = async () => {
    if (!vehicle) return
    const totalKg = loads.reduce((sum, l) => sum + (l.weight_kg ?? 0), 0)
    const ok = await confirm({
      title: `Assign ${loads.length === 1 ? loads[0].tracking_id : `${loads.length} loads`} to ${vehicle.plate_number}?`,
      message: `${totalKg > 0 ? `${formatKg(totalKg)} goes on ${vehicle.plate_number}. ` : ''}The driver is told, and the load${loads.length === 1 ? '' : 's'} leave${loads.length === 1 ? 's' : ''} the open loads list.`,
      confirmLabel: 'Assign to this vehicle',
    })
    if (ok) assign.mutate()
  }

  const price = suggestedPrice != null && suggestedPrice > 0 ? Math.round(suggestedPrice) : null

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Truck size={16} />} disabled={!vehicle || loads.length === 0} loading={assign.isPending} onClick={askAssign}>
          Assign to this vehicle
        </Button>
        <Button variant="secondary" icon={<Gavel size={16} />} disabled={!vehicle} onClick={() => setWindowOpen(true)}>
          {price != null ? `Open a capacity bidding window at ${formatRupees(price)}` : 'Open a capacity bidding window'}
        </Button>
      </div>
      {!vehicle && <Alert tone="info">Choose a vehicle from the list above to assign this load or open a window on it.</Alert>}
      <OpenWindowModal
        open={windowOpen}
        onClose={() => setWindowOpen(false)}
        initial={{
          vehicle_id: vehicle?.id ?? '',
          floor_price: price != null ? String(price) : '',
          shipment_id: loads.length === 1 ? loads[0].id : '',
        }}
      />
    </div>
  )
}
