import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cargoAPI } from '@/services/api'
import { custodyAPI } from '@/services/cargo'
import { Alert, Button, Card, CardBody, CardHeader, DetailList, FileButton, Input, Textarea, useConfirm } from '@/components/ui'
import { apiErrorMessage, backhaulKeys } from './data'
import { errorMessage, formatDateTime } from '@/utils/display'

interface DeliveryConfirmation {
  tracking_id: string
  recipient_name: string
  delivered_at: string
}

interface Payload { tracking_id: string; recipient_name: string; photo_paths?: string[]; otp?: string; reason?: string }

const PHOTO_TYPES = ['image/jpeg', 'image/png']

/**
 * Record a delivery from the control room when the driver could not confirm it in the app.
 * POST /cargo/verify-pod records a custody delivery, so it needs proof: a photo uploaded for the
 * shipment, the delivery OTP, or a reason that is logged.
 */
export default function ConfirmDeliveryTab() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [trackingId, setTrackingId] = useState('')
  const [recipient, setRecipient] = useState('')
  const [otp, setOtp] = useState('')
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<{ path: string; name: string; trackingId: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [proofError, setProofError] = useState('')

  const code = trackingId.trim().toUpperCase()
  // A photo belongs to the shipment it was uploaded for; changing the tracking ID drops it
  const photoPath = photo && photo.trackingId === code ? photo.path : null
  const hasProof = !!photoPath || !!otp.trim() || reason.trim().length >= 3

  const reset = () => { setTrackingId(''); setRecipient(''); setOtp(''); setReason(''); setPhoto(null); setProofError('') }

  const deliver = useMutation<DeliveryConfirmation, unknown, Payload>({
    mutationFn: payload => cargoAPI.verifyPod(payload),
    onSuccess: data => {
      toast.success(`${data.tracking_id} marked delivered`)
      reset()
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['cargo'] })
      queryClient.invalidateQueries({ queryKey: backhaulKeys.openLoads })
    },
  })

  const upload = async (file: File) => {
    if (!code) { setProofError('Enter the tracking ID first, so the photo is filed with the shipment.'); return }
    if (!PHOTO_TYPES.includes(file.type)) { setProofError('Upload a JPG or PNG photo.'); return }
    setUploading(true)
    setProofError('')
    try {
      const path = await custodyAPI.uploadPhoto(code, file)
      setPhoto({ path, name: file.name, trackingId: code })
    } catch (err) {
      setProofError(errorMessage(err, 'We could not upload the photo. Check the tracking ID and try again.'))
    } finally {
      setUploading(false)
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!code || !recipient.trim()) return
    if (!hasProof) { setProofError('Add a delivery photo or the delivery code, or say why there is neither.'); return }
    const payload: Payload = {
      tracking_id: code,
      recipient_name: recipient.trim(),
      ...(photoPath ? { photo_paths: [photoPath] } : {}),
      ...(otp.trim() ? { otp: otp.trim() } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }
    const ok = await confirm({
      title: `Mark ${payload.tracking_id} delivered?`,
      message: `This records ${payload.recipient_name} as the recipient and closes the shipment. It cannot be undone here.`,
      confirmLabel: 'Mark delivered',
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
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-text">Proof of delivery <span className="font-normal text-muted">(one of these)</span></legend>
              <div className="flex flex-wrap items-center gap-3">
                <FileButton accept="image/jpeg,image/png" loading={uploading} onFile={upload}>{photoPath ? 'Replace photo' : 'Add a delivery photo'}</FileButton>
                {photoPath && photo && <span className="min-w-0 break-all text-sm text-muted">{photo.name}</span>}
              </div>
              <Input
                label="Delivery OTP"
                value={otp}
                onChange={e => { deliver.reset(); setOtp(e.target.value) }}
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                hint="The code the receiver was sent, when the shipment asks for one"
              />
              <Textarea
                label="Reason"
                value={reason}
                onChange={e => { deliver.reset(); setReason(e.target.value) }}
                maxLength={300}
                hint="Logged with the delivery, for example: the driver's phone died and the receiver confirmed by phone."
              />
              {proofError && <p className="text-xs text-danger" role="alert">{proofError}</p>}
            </fieldset>
            <Button type="submit" fullWidth loading={deliver.isPending} disabled={!code || !recipient.trim() || uploading}>
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
                  { label: 'Recorded at', value: formatDateTime(deliver.data.delivered_at) },
                ]}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
