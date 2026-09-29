import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { vehiclesAPI } from '@/services/api'
import { Alert, Button, Modal, Select, Textarea, useConfirm } from '@/components/ui'
import { sosSeverityLabel, sosTypeLabel } from '@/utils/sos'
import { apiErrorMessage } from './health'

const TYPES = ['panic_button', 'accident', 'breakdown', 'medical', 'theft', 'other'] as const
type SosType = (typeof TYPES)[number]
type Severity = 'unknown' | 'serious' | 'minor'

/**
 * Staff raise an SOS for a vehicle when the driver cannot: the same alert a driver's panic button
 * makes, marked as raised by staff. A serious accident or breakdown takes the vehicle out of service.
 */
export default function RaiseSosModal({ vehicleId, plate, open, onClose }: {
  vehicleId: string
  plate: string
  open: boolean
  onClose: () => void
}) {
  const [type, setType] = useState<SosType>('panic_button')
  const [severity, setSeverity] = useState<Severity>('unknown')
  const [note, setNote] = useState('')
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()

  const raise = useMutation({
    mutationFn: () => vehiclesAPI.raiseSos(vehicleId, {
      alert_type: type,
      severity: severity === 'unknown' ? undefined : severity,
      description: note.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success(`SOS raised for ${plate}`)
      queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      setType('panic_button'); setSeverity('unknown'); setNote('')
      onClose()
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not raise the SOS. Try again.')),
  })

  const submit = async () => {
    const downs = severity === 'serious' && (type === 'accident' || type === 'breakdown')
    const ok = await confirm({
      title: `Raise SOS for ${plate}?`,
      message: downs
        ? 'Every dispatcher is alerted at once, and the vehicle moves to maintenance so it is not dispatched.'
        : 'Every dispatcher is alerted at once. Use this for a real emergency.',
      confirmLabel: 'Raise SOS',
      tone: 'danger',
    })
    if (ok) raise.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      onSubmit={submit}
      title={`Raise SOS for ${plate}`}
      description="Use this when the driver cannot raise it from the app."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={raise.isPending}>Raise SOS</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Select
          label="What happened"
          value={type}
          onChange={e => setType(e.target.value as SosType)}
          options={TYPES.map(t => ({ value: t, label: sosTypeLabel(t) }))}
        />
        <Select
          label="Injuries"
          value={severity}
          onChange={e => setSeverity(e.target.value as Severity)}
          options={[
            { value: 'unknown', label: 'Not known yet' },
            { value: 'serious', label: sosSeverityLabel('serious') ?? 'Injuries reported' },
            { value: 'minor', label: sosSeverityLabel('minor') ?? 'No injuries reported' },
          ]}
        />
        <Textarea label="Note" hint="Optional. Where the vehicle is and what dispatch should know." value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={3} />
        <Alert tone="warning">The alert is marked as raised by staff.</Alert>
      </div>
    </Modal>
  )
}
