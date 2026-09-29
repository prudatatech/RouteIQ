import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown, ClipboardCheck, Download, Eye, Paperclip, Pencil, Trash2, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { formatDate, formatKm, formatRupees } from '@/utils/display'
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, FileButton, IconButton, Input, Modal, Skeleton, StatusPill, Textarea, useConfirm } from '@/components/ui'
import { apiErrorMessage, fleetKeys, type ServiceItem } from '../health'
import { AttachmentPicker } from './AttachmentPicker'
import { openAttachment, uploadServiceFile, ATTACHMENT_ACCEPT } from './attachments'
import { istToday } from './condition'
import { ItemsTable } from './ItemsTable'
import { lineTotal } from './items'
import { LogServiceModal } from './LogServiceModal'
import { useRefreshVehicle } from './useRefreshVehicle'
import { MoveToMaintenanceModal } from './MoveToMaintenanceModal'
import { ReturnToServiceModal } from './ReturnToServiceModal'
import {
  ATTACHMENT_KIND_LABELS, maintenanceKeys, REASON_LABELS, type Attachment, type AttachmentInput, type ConditionVehicle,
  type MaintenanceJob, type ServiceRecord,
} from './types'
import { VehicleConditionCard } from './VehicleConditionCard'

const canMove = (status: string) => ['available', 'idle', 'offline', 'on_route', 'maintenance'].includes(status)

/**
 * Everything about looking after one vehicle: its current condition, the maintenance job in progress
 * (or a button to start one), and the service history with the parts and papers of each visit.
 */
export function VehicleMaintenanceTab({ vehicleId }: { vehicleId: string }) {
  const [moving, setMoving] = useState(false)
  const [returning, setReturning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [logging, setLogging] = useState(false)

  const vehicle = useQuery<ConditionVehicle>({
    queryKey: maintenanceKeys.vehicle(vehicleId),
    queryFn: () => fleetAPI.vehicle(vehicleId) as Promise<ConditionVehicle>,
  })
  const jobs = useQuery<MaintenanceJob[]>({
    queryKey: maintenanceKeys.jobs(vehicleId),
    queryFn: () => fleetAPI.maintenanceJobs({ vehicle_id: vehicleId }) as Promise<MaintenanceJob[]>,
  })
  const plans = useQuery<ServiceItem[]>({
    queryKey: maintenanceKeys.plans(vehicleId),
    queryFn: () => fleetAPI.servicePlans(vehicleId) as Promise<ServiceItem[]>,
  })

  const v = vehicle.data
  const plate = v?.plate_number ?? 'this vehicle'
  const job = jobs.data?.find(j => j.status === 'open') ?? null

  return (
    <div className="space-y-4">
      <VehicleConditionCard vehicleId={vehicleId} />

      <Card>
        <CardHeader title="Maintenance" description="The job in progress, if the vehicle is in the workshop" />
        <CardBody className="space-y-3">
          {jobs.isLoading || vehicle.isLoading ? <Skeleton className="h-24 w-full" /> : job ? (
            <JobCard job={job} onReturn={() => setReturning(true)} onEdit={() => setEditing(true)} vehicleId={vehicleId} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border px-3 py-2.5">
              <p className="min-w-0 text-sm text-muted">
                {v?.status === 'maintenance'
                  ? `${plate} is in maintenance, but no job is open for it.`
                  : v?.status === 'archived' ? `${plate} is archived.` : `${plate} is not in maintenance.`}
              </p>
              {v && canMove(v.status) && (
                <Button variant="secondary" size="sm" icon={<Wrench size={16} />} onClick={() => setMoving(true)}>
                  {v.status === 'maintenance' ? 'Open a maintenance job' : 'Move to maintenance'}
                </Button>
              )}
            </div>
          )}
          {v?.status === 'maintenance' && !job && (
            <Button size="sm" variant="ghost" onClick={() => setReturning(true)}>Return to service without a record</Button>
          )}
        </CardBody>
      </Card>

      <ServiceHistory vehicleId={vehicleId} onLog={() => setLogging(true)} />

      {moving && <MoveToMaintenanceModal open vehicleId={vehicleId} plate={plate} onClose={() => setMoving(false)} />}
      {returning && <ReturnToServiceModal open vehicleId={vehicleId} plate={plate} onClose={() => setReturning(false)} />}
      {editing && job && <EditJobModal job={job} vehicleId={vehicleId} onClose={() => setEditing(false)} />}
      {logging && (
        <LogServiceModal
          open
          vehicleId={vehicleId}
          plate={plate}
          items={(plans.data ?? []).map(p => p.item)}
          odometer={v?.odometer_km ?? null}
          onClose={() => setLogging(false)}
        />
      )}
    </div>
  )
}

// ── The job in progress ────────────────────────────────────

function JobCard({ job, vehicleId, onReturn, onEdit }: { job: MaintenanceJob; vehicleId: string; onReturn: () => void; onEdit: () => void }) {
  const refresh = useRefreshVehicle(vehicleId)
  const [files, setFiles] = useState<AttachmentInput[]>([])
  const attach = useMutation({
    mutationFn: (list: AttachmentInput[]) => fleetAPI.addJobFiles(job.id, list),
    onSuccess: () => { setFiles([]); refresh() },
    onError: err => toast.error(apiErrorMessage(err, 'We could not attach the files. Try again.')),
  })
  const released = job.released_work ? job.released_work.routes.length + job.released_work.manifests.length : 0

  return (
    <div className={`min-w-0 space-y-3 rounded-card border px-3 py-3 ${job.is_overdue ? 'border-danger/40 bg-danger-soft/40' : 'border-warning/40 bg-warning-soft/40'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">In maintenance since {formatDate(job.opened_at)}</p>
          <p className="text-sm text-muted">
            {job.expected_return_date ? `Expected back ${formatDate(job.expected_return_date)}` : 'No return date set'}
            {` · ${job.days_in_maintenance} ${job.days_in_maintenance === 1 ? 'day' : 'days'} so far`}
          </p>
        </div>
        {job.is_overdue
          ? <StatusPill tone="danger">Overdue by {job.days_overdue} {job.days_overdue === 1 ? 'day' : 'days'}</StatusPill>
          : <StatusPill tone="warning">In maintenance</StatusPill>}
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted">Reason: </dt><dd className="inline text-text">{REASON_LABELS[job.reason_type]}</dd></div>
        <div className="min-w-0"><dt className="inline text-muted">Workshop: </dt><dd className="inline break-words text-text">{job.workshop || 'Not set'}</dd></div>
        {job.note && <div className="sm:col-span-2"><dt className="inline text-muted">Note: </dt><dd className="inline break-words text-text">{job.note}</dd></div>}
        {released > 0 && (
          <div className="sm:col-span-2 text-muted">
            {released} {released === 1 ? 'route or load was' : 'routes and loads were'} released when it was moved.
          </div>
        )}
      </dl>
      <AttachmentList attachments={job.attachments} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<ClipboardCheck size={16} />} onClick={onReturn}>Return to service</Button>
        <Button size="sm" variant="secondary" icon={<Pencil size={16} />} onClick={onEdit}>Change details</Button>
      </div>
      <AttachmentPicker vehicleId={vehicleId} value={files} onChange={setFiles} label="Add job card or photos" />
      {files.length > 0 && (
        <Button size="sm" loading={attach.isPending} onClick={() => attach.mutate(files)}>Attach {files.length} {files.length === 1 ? 'file' : 'files'}</Button>
      )}
    </div>
  )
}

function EditJobModal({ job, vehicleId, onClose }: { job: MaintenanceJob; vehicleId: string; onClose: () => void }) {
  const [expected, setExpected] = useState(job.expected_return_date?.slice(0, 10) ?? '')
  const [workshop, setWorkshop] = useState(job.workshop ?? '')
  const [note, setNote] = useState(job.note ?? '')
  const [error, setError] = useState('')
  const [expectedError, setExpectedError] = useState('')
  const refresh = useRefreshVehicle(vehicleId)
  const save = useMutation({
    mutationFn: (body: object) => fleetAPI.updateMaintenanceJob(job.id, body),
    onSuccess: () => { toast.success('Maintenance details saved'); refresh(); onClose() },
    onError: err => setError(apiErrorMessage(err, 'We could not save the changes. Try again.')),
  })
  const submit = () => {
    if (expected && expected < istToday() && expected !== job.expected_return_date?.slice(0, 10)) { setExpectedError('The expected return date cannot be in the past.'); return }
    setError('')
    setExpectedError('')
    save.mutate({ expected_return_date: expected || null, workshop: workshop.trim() || null, note: note.trim() || null })
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      onSubmit={submit}
      title="Change maintenance details"
      footer={(<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></>)}
    >
      <div className="space-y-4">
        <Input label="Expected back on" type="date" value={expected} onChange={e => { setExpected(e.target.value); setExpectedError('') }} error={expectedError} />
        <Input label="Workshop or place" value={workshop} onChange={e => setWorkshop(e.target.value)} maxLength={120} hint="Optional, name or place" />
        <Textarea label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} hint="Optional" />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

// ── Files ──────────────────────────────────────────────────

const fileSize = (bytes: number | null) => (bytes == null ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Files on a record or job, each to view or download, and (when `onDelete` is given) to remove. */
function AttachmentList({ attachments, onDelete }: { attachments: Attachment[]; onDelete?: (a: Attachment) => void }) {
  if (attachments.length === 0) return null
  const open = (a: Attachment, download: boolean) => openAttachment(a.id, download).catch(err => toast.error(err.message))
  return (
    <ul className="divide-y divide-border rounded-control border border-border bg-surface">
      {attachments.map(a => (
        <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <Paperclip size={16} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-text" title={a.file_name ?? undefined}>{a.file_name ?? 'File'}</span>
          <span className="hidden shrink-0 text-xs text-muted sm:inline">{ATTACHMENT_KIND_LABELS[a.kind]} {fileSize(a.size_bytes) && `· ${fileSize(a.size_bytes)}`}</span>
          <IconButton label={`View ${a.file_name ?? 'file'}`} size="sm" icon={<Eye size={16} />} onClick={() => open(a, false)} />
          <IconButton label={`Download ${a.file_name ?? 'file'}`} size="sm" icon={<Download size={16} />} onClick={() => open(a, true)} />
          {onDelete && <IconButton label={`Delete ${a.file_name ?? 'file'}`} size="sm" icon={<Trash2 size={16} />} onClick={() => onDelete(a)} />}
        </li>
      ))}
    </ul>
  )
}

// ── History ────────────────────────────────────────────────

function ServiceHistory({ vehicleId, onLog }: { vehicleId: string; onLog: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const log = useQuery<ServiceRecord[]>({
    queryKey: fleetKeys.log(vehicleId),
    queryFn: () => fleetAPI.serviceLog(vehicleId) as Promise<ServiceRecord[]>,
  })

  return (
    <Card>
      <CardHeader
        title="Service history"
        description="Every service logged, with parts and papers"
        actions={<Button size="sm" variant="secondary" icon={<ClipboardCheck size={16} />} onClick={onLog}>Log service</Button>}
        className="flex-wrap"
      />
      {log.isLoading ? <CardBody><Skeleton className="h-16 w-full" /></CardBody> : log.isError ? (
        <CardBody>
          <Alert tone="danger" title="We could not load the service history" action={<Button size="sm" variant="secondary" onClick={() => log.refetch()}>Try again</Button>}>
            Check your connection and try again.
          </Alert>
        </CardBody>
      ) : (log.data ?? []).length === 0 ? (
        <EmptyState
          compact
          icon={<ClipboardCheck size={20} />}
          title="No service logged yet"
          description="Log a service to keep its cost, parts and invoice with this vehicle."
          action={<Button size="sm" icon={<ClipboardCheck size={16} />} onClick={onLog}>Log service</Button>}
        />
      ) : (
        <ul className="divide-y divide-border">
          {(log.data ?? []).map(r => (
            <li key={r.id}>
              <button
                type="button"
                aria-expanded={openId === r.id}
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand sm:px-6"
              >
                <ChevronDown size={16} aria-hidden="true" className={`mt-0.5 shrink-0 text-muted transition-transform ${openId === r.id ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-text">{r.item}</span>
                    <span className="shrink-0 text-sm text-muted">{formatDate(r.done_at)}</span>
                  </span>
                  <span className="block break-words text-xs text-muted">
                    {[
                      r.odometer_km != null && formatKm(r.odometer_km),
                      r.cost != null && formatRupees(r.cost),
                      r.workshop,
                      r.items.length > 0 && `${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}`,
                      r.attachments.length > 0 && `${r.attachments.length} ${r.attachments.length === 1 ? 'file' : 'files'}`,
                    ].filter(Boolean).join(' · ') || 'No details'}
                  </span>
                </span>
              </button>
              {openId === r.id && <RecordDetail record={r} vehicleId={vehicleId} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RecordDetail({ record, vehicleId }: { record: ServiceRecord; vehicleId: string }) {
  const { confirm } = useConfirm()
  const refresh = useRefreshVehicle(vehicleId)
  const [uploading, setUploading] = useState(false)

  const addItems = useMutation({
    mutationFn: (item: { description: string; kind: 'part' | 'repair'; quantity: number; unit_cost: number }) => fleetAPI.addServiceItems(record.id, [item]),
    onSuccess: () => refresh(),
    onError: err => toast.error(apiErrorMessage(err, 'We could not add the item. Try again.')),
  })
  const removeItem = useMutation({
    mutationFn: (id: string) => fleetAPI.deleteServiceItem(id),
    onSuccess: () => refresh(),
    onError: err => toast.error(apiErrorMessage(err, 'We could not remove the item. Try again.')),
  })
  const removeFile = useMutation({
    mutationFn: (id: string) => fleetAPI.deleteAttachment(id),
    onSuccess: () => refresh(),
    onError: err => toast.error(apiErrorMessage(err, 'We could not delete the file. Try again.')),
  })

  const addFile = async (file: File) => {
    setUploading(true)
    try {
      const uploaded = await uploadServiceFile(vehicleId, file)
      await fleetAPI.addRecordFiles(record.id, [uploaded])
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : apiErrorMessage(err, 'We could not attach the file. Try again.'))
    } finally {
      setUploading(false)
    }
  }

  const onDeleteFile = async (a: Attachment) => {
    const ok = await confirm({ title: `Delete ${a.file_name ?? 'this file'}?`, message: 'The file is removed for good.', confirmLabel: 'Delete file', tone: 'danger' })
    if (ok) removeFile.mutate(a.id)
  }

  return (
    <div className="space-y-3 border-t border-border bg-surface-subtle/40 px-4 py-3 sm:px-6">
      <ItemsTable
        rows={record.items.map(i => ({ key: i.id, description: i.description, kind: i.kind, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost), total: Number(i.total_cost) || lineTotal(i) }))}
        onAdd={item => addItems.mutateAsync(item).then(() => undefined, () => undefined)}
        onRemove={key => removeItem.mutate(key)}
        busy={addItems.isPending || removeItem.isPending}
      />
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {record.labour_cost != null && <div><dt className="inline text-muted">Labour: </dt><dd className="inline text-text">{formatRupees(record.labour_cost)}</dd></div>}
        <div><dt className="inline text-muted">Total: </dt><dd className="inline font-medium text-text">{record.cost != null ? formatRupees(record.cost) : 'Not recorded'}</dd></div>
        {record.invoice_number && <div><dt className="inline text-muted">Invoice: </dt><dd className="inline text-text">{record.invoice_number}</dd></div>}
        {record.note && <div className="sm:col-span-2"><dt className="inline text-muted">Note: </dt><dd className="inline text-text">{record.note}</dd></div>}
      </dl>
      <AttachmentList attachments={record.attachments} onDelete={onDeleteFile} />
      <FileButton variant="secondary" size="sm" icon={<Paperclip size={16} />} accept={ATTACHMENT_ACCEPT} loading={uploading} onFile={addFile}>
        Add invoice, job card or photo
      </FileButton>
    </div>
  )
}
