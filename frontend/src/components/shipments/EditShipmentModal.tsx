import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Input, Modal, Select } from '@/components/ui'
import { shipmentsAPI } from '@/services/api'
import { PRIORITIES, apiErrorMessage } from './format'
import type { ShipmentRow } from './types'

const priorityOptions = PRIORITIES.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))

/** Change priority, item count and weight of a shipment (PATCH /shipments/:id/edit). */
export default function EditShipmentModal({ shipment, onClose }: { shipment: ShipmentRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [priority, setPriority] = useState('medium')
  const [items, setItems] = useState('')
  const [weight, setWeight] = useState('')
  const [price, setPrice] = useState('')
  const [errors, setErrors] = useState<{ items?: string; weight?: string; price?: string }>({})

  useEffect(() => {
    if (!shipment) return
    setPriority(shipment.priority || 'medium')
    setItems(shipment.total_items != null ? String(shipment.total_items) : '')
    setWeight(shipment.total_weight_kg != null ? String(shipment.total_weight_kg) : '')
    setPrice(shipment.freight_charge != null ? String(shipment.freight_charge) : '')
    setErrors({})
  }, [shipment])

  const mutation = useMutation({
    mutationFn: (data: { priority: string; total_items: number; total_weight_kg: number; freight_charge?: number }) => shipmentsAPI.edit(shipment!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success('Shipment updated')
      onClose()
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not update the shipment. Try again.')),
  })

  const save = () => {
    const totalItems = Number(items)
    const totalWeight = Number(weight)
    const next: typeof errors = {}
    if (!Number.isInteger(totalItems) || totalItems < 1) next.items = 'Enter a whole number of 1 or more.'
    if (!(totalWeight > 0)) next.weight = 'Enter a weight above 0.'
    if (price.trim() && !(Number(price) >= 0)) next.price = 'Enter a price of 0 or more, or leave it empty.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    mutation.mutate({ priority, total_items: totalItems, total_weight_kg: totalWeight, ...(price.trim() ? { freight_charge: Number(price) } : {}) })
  }

  return (
    <Modal
      open={!!shipment}
      onClose={onClose}
      title="Edit shipment"
      description={shipment?.tracking_id}
      size="sm"
      onSubmit={save}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)} options={priorityOptions} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Items"
            type="number"
            inputMode="numeric"
            min={1}
            required
            value={items}
            error={errors.items}
            onChange={e => setItems(e.target.value)}
          />
          <Input
            label="Weight"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            required
            trailing="kg"
            value={weight}
            error={errors.weight}
            onChange={e => setWeight(e.target.value)}
          />
        </div>
        <Input
          label="Price (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          leading="₹"
          value={price}
          error={errors.price}
          hint="What the customer is charged, before GST."
          onChange={e => setPrice(e.target.value)}
        />
      </div>
    </Modal>
  )
}
