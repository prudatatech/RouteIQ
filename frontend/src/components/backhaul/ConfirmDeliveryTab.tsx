import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cargoAPI } from '@/services/api'
import { Alert, Button, Card, CardBody, CardHeader, DetailList, Input, useConfirm } from '@/components/ui'
import { apiErrorMessage, backhaulKeys } from './data'

interface DeliveryConfirmation {
  tracking_id: string
  recipient_name: string
  delivered_at: string
}

/** Record a delivery from the control room when the driver could not confirm it in the app. */
export default function ConfirmDeliveryTab() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [trackingId, setTrackingId] = useState('')
  const [recipient, setRecipient] = useState('')

  const deliver = useMutation<DeliveryConfirmation, unknown, { tracking_id: string; recipient_name: string }>({
    mutationFn: payload => cargoAPI.verifyPod(payload),
    onSuccess: data => {
      toast.success(`${data.tracking_id} marked delivered`)
      setTrackingId('')
      setRecipient('')
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: backhaulKeys.openLoads })
    },
  })

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const payload = { tracking_id: trackingId.trim(), recipient_name: recipient.trim() }
    if (!payload.tracking_id || !payload.recipient_name) return
    const ok = await confirm({
      title: `Mark ${payload.tracking_id} delivered?`,
      message: `This records ${payload.recipient_name} as the recipient and closes the shipment. It cannot be undone here.`,
      confirmLabel: 'Confirm delivery',
    })
    if (ok) deliver.mutate(payload)
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Confirm a delivery" description="Drivers usually confirm deliveries in the driver app. Use this when it has to be recorded here." />
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Input
              label="Tracking ID"
              value={trackingId}
              onChange={e => { deliver.reset(); setTrackingId(e.target.value) }}
              placeholder="For example RTX-1A2B3C4D"
              autoComplete="off"
              required
            />
            <Input
              label="Received by"
              value={recipient}
              onChange={e => { deliver.reset(); setRecipient(e.target.value) }}
              placeholder="Receiver's full name"
              autoComplete="off"
              required
            />
            <Button type="submit" fullWidth loading={deliver.isPending} disabled={!trackingId.trim() || !recipient.trim()}>
              Confirm delivery
            </Button>
          </form>
        </CardBody>
      </Card>

      <div>
        {deliver.isError && (
          <Alert tone="danger" title="We could not confirm this delivery">
            {apiErrorMessage(deliver.error, 'Check your connection and try again.')}
          </Alert>
        )}
        {deliver.data && (
          <Card>
            <CardHeader title="Delivery confirmed" />
            <CardBody>
              <DetailList
                items={[
                  { label: 'Tracking ID', value: <span className="font-mono">{deliver.data.tracking_id}</span> },
                  { label: 'Received by', value: deliver.data.recipient_name },
                  { label: 'Recorded at', value: new Date(deliver.data.delivered_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) },
                ]}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
