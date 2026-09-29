import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Camera, Check, ClipboardCheck, Phone, Truck, User, X } from 'lucide-react'
import { vehicleRequestsAPI, type VehicleRequest } from '@/services/api'
import { supabase, openChannel } from '@/services/supabase'
import {
  Page, PageHeader, Card, CardBody, Button, DetailList, EmptyState, ErrorState, Modal, Skeleton, StatusPill, Textarea, humanize, useConfirm,
} from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { expiryStatus } from '@/utils/documentExpiry'
import { errorMessage, formatDate, formatDateTime, formatRelative } from '@/utils/display'

const DOCUMENTS = [
  { label: 'RC', number: 'rc_number', expiry: 'rc_expiry', file: 'rc_document_url' },
  { label: 'Insurance', number: 'insurance_number', expiry: 'insurance_expiry', file: 'insurance_document_url' },
  { label: 'Fitness', number: 'fitness_certificate_number', expiry: 'fitness_expiry', file: 'fitness_document_url' },
  { label: 'Permit', number: 'permit_number', expiry: 'permit_expiry', file: 'permit_document_url' },
  { label: 'PUC', number: 'puc_number', expiry: 'puc_expiry', file: 'puc_document_url' },
] as const

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Vehicles drivers registered from the app. They take no work until someone approves them here. */
export default function VehicleRequestsPage() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [rejecting, setRejecting] = useState<VehicleRequest | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('open')
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tick)
  }, [])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vehicle-requests'],
    queryFn: vehicleRequestsAPI.list,
    refetchInterval: 30_000,
  })

  // A new request or a decision made elsewhere shows up without a reload
  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['vehicle-requests'] })
    const channel = openChannel('vehicle_requests_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_photos' }, invalidate)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  const decided = () => {
    queryClient.invalidateQueries({ queryKey: ['vehicle-requests'] })
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
  }

  const approve = useMutation({
    mutationFn: (id: string) => vehicleRequestsAPI.approve(id),
    onSuccess: () => { toast.success('Vehicle approved. The driver has been told.'); decided() },
    onError: err => toast.error(errorMessage(err, 'We could not approve this vehicle. Try again.')),
  })
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => vehicleRequestsAPI.reject(id, reason),
    onSuccess: () => { toast.success('Vehicle rejected and archived. The driver has been told why.'); closeReject(); decided() },
    onError: err => toast.error(errorMessage(err, 'We could not reject this vehicle. Try again.')),
  })

  const askApprove = async (r: VehicleRequest) => {
    const ok = await confirm({
      title: `Approve ${r.vehicle.plate_number}?`,
      message: `${r.driver?.full_name ?? 'The driver'} can start taking work with this vehicle, and it appears in your fleet as available.`,
      confirmLabel: 'Approve vehicle',
    })
    if (ok) approve.mutate(r.vehicle.id)
  }

  const askReject = (r: VehicleRequest) => {
    setReason('')
    setReasonError(undefined)
    setRejecting(r)
  }

  function closeReject() {
    setRejecting(null)
    setReason('')
    setReasonError(undefined)
  }

  const submitReject = () => {
    if (!rejecting) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setReasonError('Enter a reason so the driver knows what to fix.')
      return
    }
    reject.mutate({ id: rejecting.vehicle.id, reason: trimmed })
  }

  const pending = data?.pending ?? 0
  const requests = data?.requests ?? []

  return (
    <Page>
      <PageHeader
        title="Vehicle requests"
        description={isLoading ? 'Vehicles drivers registered from the app.' : pending === 0
          ? 'Vehicles drivers registered from the app wait here for your approval.'
          : `${pending.toLocaleString('en-IN')} ${pending === 1 ? 'vehicle is' : 'vehicles are'} waiting for approval. They take no work until you approve them.`}
      />

      {error ? (
        <ErrorState title="We could not load the requests" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading requests">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={22} />} title="No vehicle requests" description="When a driver registers a vehicle in the app, it shows up here." />
      ) : (
        <div className="space-y-4">
          {requests.map(r => (
            <RequestCard
              key={r.vehicle.id}
              request={r}
              now={now}
              highlighted={openId === r.vehicle.id}
              onSeen={() => setSearchParams(params => { params.delete('open'); return params }, { replace: true })}
              busy={(approve.isPending && approve.variables === r.vehicle.id) || (reject.isPending && reject.variables?.id === r.vehicle.id)}
              onApprove={() => askApprove(r)}
              onReject={() => askReject(r)}
              onViewPhoto={(url, name) => setViewing({ url, name })}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!rejecting}
        onClose={() => { if (!reject.isPending) closeReject() }}
        title={`Reject ${rejecting?.vehicle.plate_number ?? 'vehicle'}?`}
        description="The vehicle is archived with your reason. The driver sees it in the app and can fix the details and submit again."
        size="sm"
        onSubmit={submitReject}
        footer={(
          <>
            <Button variant="secondary" disabled={reject.isPending} onClick={closeReject}>Cancel</Button>
            <Button type="submit" variant="danger" loading={reject.isPending}>Reject vehicle</Button>
          </>
        )}
      >
        <Textarea
          data-autofocus
          label="Reason"
          required
          placeholder="For example: the plate number does not match the RC"
          value={reason}
          disabled={reject.isPending}
          error={reasonError}
          onChange={e => { setReason(e.target.value); if (reasonError) setReasonError(undefined) }}
        />
      </Modal>

      {viewing && <DocumentViewerModal isOpen onClose={() => setViewing(null)} fileUrl={viewing.url} fileName={viewing.name} />}
    </Page>
  )
}

function RequestCard({ request, now, highlighted, onSeen, busy, onApprove, onReject, onViewPhoto }: {
  request: VehicleRequest
  now: number
  highlighted: boolean
  onSeen: () => void
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onViewPhoto: (url: string, name: string) => void
}) {
  const { vehicle, driver, photos, primary_photo_url: primary, submitted_at: submittedAt } = request
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!highlighted) return
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // Keep the highlight for a moment, then drop ?open= from the address
    const timer = setTimeout(onSeen, 4000)
    return () => clearTimeout(timer)
  }, [highlighted, onSeen])

  const model = text(vehicle.vehicle_model)
  const container = (vehicle.container_length_ft as number | null) ?? 0
  const filled = DOCUMENTS.filter(d => text(vehicle[d.number]) || text(vehicle[d.expiry]))

  return (
    <div ref={ref}>
      <Card className={highlighted ? 'ring-2 ring-brand' : undefined}>
        <CardBody>
          <div className="flex flex-col gap-5 lg:flex-row">
            <div className="w-full shrink-0 lg:w-56">
              <div className="aspect-video lg:aspect-[4/3] overflow-hidden rounded-control border border-border bg-surface-subtle">
                {primary ? (
                  <button type="button" className="block h-full w-full" onClick={() => onViewPhoto(primary, `${vehicle.plate_number} photo`)} aria-label={`View the photo of ${vehicle.plate_number}`}>
                    <img src={primary} alt={`${vehicle.plate_number}`} className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-muted">
                    <Camera size={22} aria-hidden="true" />
                    No photo added
                  </div>
                )}
              </div>
              {photos.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {photos.filter(p => p.url && p.url !== primary).map(p => (
                    <button key={p.slot} type="button" className="h-12 w-16 overflow-hidden rounded-control border border-border" onClick={() => onViewPhoto(p.url!, `${vehicle.plate_number} ${p.slot} photo`)} aria-label={`View the ${p.slot} photo`}>
                      <img src={p.url!} alt={`${humanize(p.slot)} of ${vehicle.plate_number}`} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-text">{vehicle.plate_number}</h2>
                    <StatusPill status="pending_approval" />
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{model ?? humanize(vehicle.vehicle_type)}</p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button variant="secondary" className="flex-1 sm:flex-none" icon={<X size={16} />} disabled={busy} onClick={onReject}>Reject</Button>
                  <Button className="flex-1 sm:flex-none" icon={<Check size={16} />} loading={busy} onClick={onApprove}>Approve</Button>
                </div>
              </div>

              <DetailList
                columns={3}
                className="grid-cols-2 lg:grid-cols-3"
                items={[
                  { label: 'Driver', value: driver ? <span className="inline-flex items-center gap-1.5"><User size={14} className="text-muted" aria-hidden="true" />{driver.full_name || 'Name not set'}</span> : 'Not linked' },
                  { label: 'Phone', value: driver?.phone ? <a className="inline-flex items-center gap-1.5 text-brand hover:underline" href={`tel:${driver.phone}`}><Phone size={14} aria-hidden="true" />{driver.phone}</a> : '—' },
                  { label: 'Submitted', value: submittedAt ? <span title={formatDateTime(submittedAt)}>{formatRelative(submittedAt, now)}</span> : '—' },
                  { label: 'Type', value: humanize(vehicle.vehicle_type) },
                  { label: 'Capacity', value: vehicle.capacity_kg ? `${Number(vehicle.capacity_kg).toLocaleString('en-IN')} kg` : '—' },
                  { label: 'Container size', value: container > 0 ? `${container} × ${vehicle.container_width_ft ?? 0} × ${vehicle.container_height_ft ?? 0} ft` : 'Not recorded' },
                ]}
              />

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-text"><Truck size={14} className="text-muted" aria-hidden="true" />Documents</p>
                {filled.length === 0 ? (
                  <p className="text-sm text-muted">The driver did not enter any document numbers.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {filled.map(d => {
                      const expiry = expiryStatus(text(vehicle[d.expiry]))
                      const file = text(vehicle[d.file])
                      return (
                        <li key={d.label} className="rounded-control border border-border px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-text">{d.label}</span>
                            {expiry && <StatusPill tone={expiry.tone} dot={false}>{expiry.label}</StatusPill>}
                          </div>
                          <p className="mt-0.5 break-all text-muted">
                            {text(vehicle[d.number]) ?? 'No number'}
                            {text(vehicle[d.expiry]) ? ` · valid to ${formatDate(text(vehicle[d.expiry]))}` : ''}
                          </p>
                          {file && /^https?:\/\//.test(file) && (
                            <a className="text-brand hover:underline" href={file} target="_blank" rel="noopener noreferrer">View file</a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
