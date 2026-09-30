import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRightLeft, FileText, ShieldQuestion, UserCheck, UserPlus } from 'lucide-react'
import {
  Alert, Button, Card, CardBody, CardHeader, DataTable, DetailList, EmptyState, ErrorState, Modal, Page, PageHeader, Select, Skeleton,
  StatusPill, buttonClasses, statusToLabel, useConfirm, type Column,
} from '@/components/ui'
import { MapView, type MapPoint, type MapVehicle } from '@/components/map'
import { usersAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { errorMessage, formatDateTime, formatKg, formatRelative, formatRupees } from '@/utils/display'
import {
  cargoKeys, exceptionsAPI, type ClaimSummary, type ExceptionDetail, type ExceptionItem, type ExceptionStatus,
} from '@/services/cargo'
import { ConditionPill, ConsignmentLink, SeverityPill, SlaBadge } from '@/components/cargo/CargoBits'
import { useNow } from '@/components/cargo/useNow'
import { CaseTimeline } from '@/components/cargo/CustodyTimeline'
import ExceptionActionModal from '@/components/cargo/ExceptionActionModal'
import { ClaimDrawerById } from '@/components/cargo/ClaimDrawer'
import {
  ACTION_META, PANEL_ACTIONS, claimTypeLabel, exceptionActions, exceptionTypeLabel, isActiveTransfer, positionOf, resolutionLabel,
  slaState, sourceLabel, statusMoves, type ActionValues, type PanelAction,
} from '@/components/cargo/logic'

const isNotFound = (err: unknown) => (err as { response?: { status?: number } })?.response?.status === 404
const MOVE_LABEL: Partial<Record<ExceptionStatus, string>> = {
  investigating: 'Start investigating',
  action_planned: 'Mark action planned',
  closed: 'Close case',
}

export default function ExceptionCasePage() {
  const { id = '' } = useParams<{ id: string }>()
  const query = useQuery({
    queryKey: cargoKeys.exception(id),
    queryFn: () => exceptionsAPI.get(id),
    enabled: !!id,
    refetchInterval: 30_000,
    retry: (count, err) => !isNotFound(err) && count < 2,
  })

  if (query.isLoading) {
    return (
      <Page>
        <PageHeader title={<Skeleton className="h-8 w-48" />} back={{ to: '/cargo', label: 'Cargo' }} />
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>
      </Page>
    )
  }
  if (!query.data) {
    return (
      <Page>
        <PageHeader title="Case" back={{ to: '/cargo', label: 'Cargo' }} />
        {isNotFound(query.error) || !query.isError ? (
          <EmptyState
            icon={<ShieldQuestion size={22} />}
            title="We could not find this case"
            description="It may have been closed and removed. Go back to the queue to pick another one."
            action={<Link to="/cargo" className={buttonClasses({ variant: 'secondary' })}>Back to the queue</Link>}
          />
        ) : (
          <ErrorState title="We could not load this case" description="Check your connection and try again." onRetry={() => query.refetch()} />
        )}
      </Page>
    )
  }
  return <CaseView kase={query.data} />
}

function CaseView({ kase }: { kase: ExceptionDetail }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const myId = useAuthStore(s => s.userId)
  const now = useNow(30_000)
  const [searchParams, setSearchParams] = useSearchParams()
  const [action, setAction] = useState<{ name: PanelAction; preset?: ActionValues } | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [openClaimId, setOpenClaimId] = useState<string | null>(null)
  const [pickedRelief, setPickedRelief] = useState<string | null>(null)

  const activeTransfer = kase.transfers.some(t => isActiveTransfer(t.status))
  const actions = exceptionActions(kase, { activeTransfer })
  const canTransship = actions.includes('transship')

  const relief = useQuery({
    queryKey: cargoKeys.relief(kase.id),
    queryFn: () => exceptionsAPI.reliefVehicles(kase.id),
    enabled: canTransship,
    staleTime: 60_000,
  })

  // ?action=transship (from the SOS panel or the maintenance modal) opens that form once, if the case allows it.
  const requested = searchParams.get('action') as PanelAction | null
  useEffect(() => {
    if (!requested) return
    if ((PANEL_ACTIONS as readonly string[]).includes(requested) && actions.includes(requested)) setAction({ name: requested })
    else toast(`${ACTION_META[requested as PanelAction]?.label ?? 'That action'} is not available for this case now.`)
    setSearchParams(p => { p.delete('action'); return p }, { replace: true })
    // Runs once per requested action
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])

  const act = useMutation({
    mutationFn: (body: Parameters<typeof exceptionsAPI.act>[1]) => exceptionsAPI.act(kase.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cargoKeys.all }),
    onError: err => toast.error(errorMessage(err, 'We could not update the case. Try again.')),
  })

  const moveStatus = async (to: ExceptionStatus) => {
    if (to === 'closed') {
      const ok = await confirm({
        title: `Close ${kase.code} without an outcome?`,
        message: 'Use Resolve when the goods were dealt with. Close is for a case opened by mistake or a duplicate. The deadline stops.',
        confirmLabel: 'Close case',
        cancelLabel: 'Keep it open',
        tone: 'danger',
      })
      if (!ok) return
    }
    act.mutate({ action: 'set_status', status: to }, { onSuccess: () => toast.success(`Case ${statusToLabel(to, 'case').toLowerCase()}`) })
  }

  const takeOwnership = () => {
    if (!myId) return
    act.mutate({ action: 'assign_owner', owner_id: myId }, { onSuccess: () => toast.success('You own this case now') })
  }

  const sla = slaState(kase.sla_due_at, kase.status, now)
  const vehiclePos = positionOf(kase.vehicle)
  const casePos = kase.lat != null && kase.lng != null && !(kase.lat === 0 && kase.lng === 0) ? { lat: kase.lat, lng: kase.lng } : null
  const totalPieces = kase.items.reduce((n, i) => n + (i.pieces_affected ?? 0), 0)
  const totalKg = kase.items.reduce((n, i) => n + (Number(i.weight_affected_kg) || 0), 0)

  const mapVehicles: MapVehicle[] = useMemo(() => {
    const list: MapVehicle[] = []
    if (kase.vehicle && vehiclePos) {
      list.push({ id: kase.vehicle.id, label: kase.vehicle.plate_number, status: kase.vehicle.status ?? 'maintenance', position: vehiclePos, vehicle_type: kase.vehicle.vehicle_type })
    }
    if (canTransship) {
      for (const [i, r] of (relief.data ?? []).slice(0, 8).entries()) {
        const pos = positionOf(r.vehicle)
        if (pos && r.vehicle.id !== kase.vehicle_id) {
          list.push({ id: r.vehicle.id, label: `${i + 1}. ${r.vehicle.plate_number}`, status: r.vehicle.status ?? 'available', position: pos, vehicle_type: r.vehicle.vehicle_type })
        }
      }
    }
    return list
  }, [kase.vehicle, kase.vehicle_id, vehiclePos, canTransship, relief.data])
  const mapPoints: MapPoint[] = casePos ? [{ id: 'case', kind: 'incident', position: casePos, label: `${kase.code}: ${exceptionTypeLabel(kase.type)}`, active: sla.state === 'overdue' }] : []

  const itemColumns: Column<ExceptionItem>[] = [
    { key: 'ref', header: 'Consignment', cell: i => <ConsignmentLink c={i} /> },
    { key: 'status', header: 'Status', cell: i => (i.status ? <StatusPill status={i.status} kind="cargo" /> : '—') },
    {
      key: 'pieces',
      header: 'Pieces affected',
      align: 'right',
      cell: i => (
        <span className="tabular">
          {i.pieces_affected != null ? i.pieces_affected.toLocaleString('en-IN') : '—'}
          {i.pieces_total != null && <span className="text-muted"> of {i.pieces_total.toLocaleString('en-IN')}</span>}
        </span>
      ),
    },
    { key: 'weight', header: 'Weight', align: 'right', hideBelow: 'md', cell: i => formatKg(i.weight_affected_kg) },
    { key: 'condition', header: 'Condition', cell: i => <ConditionPill condition={i.condition} /> },
    { key: 'note', header: 'Note', hideBelow: 'lg', cell: i => i.note || <span className="text-muted">—</span> },
  ]

  return (
    <Page>
      <PageHeader
        back={{ to: '/cargo', label: 'Cargo' }}
        title={(
          <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-3">
            <span className="font-mono">{kase.code}</span>
            <StatusPill status={kase.status} kind="case" />
            <SeverityPill severity={kase.severity} />
          </span>
        )}
        description={`${exceptionTypeLabel(kase.type)} · ${sourceLabel(kase.source ?? 'manual')} · raised ${formatRelative(kase.created_at, now)}`}
        actions={(
          <>
            {statusMoves(kase.status).map(to => (
              <Button
                key={to}
                variant={to === 'closed' ? 'ghost' : 'secondary'}
                disabled={act.isPending}
                loading={act.isPending && act.variables?.action === 'set_status' && act.variables.status === to}
                onClick={() => moveStatus(to)}
              >
                {MOVE_LABEL[to] ?? statusToLabel(to, 'case')}
              </Button>
            ))}
          </>
        )}
      />

      {sla.state === 'overdue' && (
        <Alert tone="danger" title={`This case is ${sla.label.toLowerCase()}`}>
          {kase.escalation_count > 0
            ? `Escalated ${kase.escalation_count.toLocaleString('en-IN')} ${kase.escalation_count === 1 ? 'time' : 'times'}${kase.last_escalated_at ? `, last ${formatRelative(kase.last_escalated_at, now)}` : ''}.`
            : 'Plan an action or resolve it.'}
        </Alert>
      )}

      <Card padded>
        <DetailList
          columns={3}
          items={[
            {
              label: 'Deadline',
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <SlaBadge dueAt={kase.sla_due_at} status={kase.status} now={now} />
                  {kase.sla_due_at && <span className="text-xs text-muted">{formatDateTime(kase.sla_due_at)}</span>}
                </span>
              ),
            },
            {
              label: 'Owner',
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  {kase.owner_id ? <span>{kase.owner?.full_name ?? 'Assigned'}{kase.owner_id === myId ? ' (you)' : ''}</span> : <span className="text-warning">Unassigned</span>}
                  {kase.owner_id !== myId && myId && (
                    <Button size="sm" variant="secondary" icon={<UserCheck size={14} />} disabled={act.isPending} onClick={takeOwnership}>Take it</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<UserPlus size={14} />} onClick={() => setAssigning(true)}>Assign</Button>
                </span>
              ),
            },
            {
              label: 'Vehicle',
              value: kase.vehicle
                ? (
                  <span>
                    <Link to={`/fleet/${kase.vehicle.id}`} className="font-mono text-brand hover:underline">{kase.vehicle.plate_number}</Link>
                    {kase.vehicle.driver_name && <span className="text-muted"> · {kase.vehicle.driver_name}</span>}
                  </span>
                )
                : 'No vehicle',
            },
            {
              label: 'Raised from',
              value: kase.sos_alert_id
                ? <Link to={`/emergency?open=${kase.sos_alert_id}`} className="text-brand hover:underline">SOS alert</Link>
                : kase.maintenance_job_id && kase.vehicle_id
                  ? <Link to={`/fleet/${kase.vehicle_id}?tab=maintenance`} className="text-brand hover:underline">Maintenance job</Link>
                  : sourceLabel(kase.source ?? 'manual'),
            },
            { label: 'Goods affected', value: `${totalPieces.toLocaleString('en-IN')} pieces${totalKg > 0 ? `, ${formatKg(totalKg)}` : ''} in ${kase.items.length.toLocaleString('en-IN')} ${kase.items.length === 1 ? 'consignment' : 'consignments'}` },
            ...(kase.resolution ? [{ label: 'Outcome', value: `${resolutionLabel(kase.resolution)}${kase.resolved_at ? `, ${formatDateTime(kase.resolved_at)}` : ''}` }] : []),
          ]}
        />
        {kase.description && <p className="mt-4 whitespace-pre-line break-words border-t border-border pt-4 text-sm text-text">{kase.description}</p>}
        {kase.resolution_note && <p className="mt-2 text-sm text-muted">Outcome note: {kase.resolution_note}</p>}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="order-first space-y-4 lg:order-last">
          <Card>
            <CardHeader title="What to do next" description={activeTransfer ? 'A transfer is under way. Finish or cancel it before planning something else.' : 'Only the steps that fit this case are shown.'} />
            <CardBody>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {actions.map(name => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => setAction({ name, preset: name === 'transship' && pickedRelief ? { to_vehicle_id: pickedRelief } : undefined })}
                      className="flex w-full flex-col items-start rounded-control border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <span className={ACTION_META[name].tone === 'danger' ? 'text-sm font-medium text-danger' : 'text-sm font-medium text-text'}>{ACTION_META[name].label}</span>
                      <span className="text-xs text-muted">{ACTION_META[name].description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Transfers" />
            {kase.transfers.length === 0 ? (
              <EmptyState compact icon={<ArrowRightLeft size={22} />} title="No transfers" description="Transship or Move to hub plans one." />
            ) : (
              <ul className="divide-y divide-border">
                {kase.transfers.map(t => (
                  <li key={t.id}>
                    <Link to={`/cargo/transfers/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-subtle sm:px-6">
                      <span className="min-w-0">
                        <span className="block font-mono font-medium text-text">{t.code}</span>
                        <span className="block truncate text-xs text-muted">
                          To {t.to_vehicle?.plate_number ?? t.to_depot?.name ?? (t.to_depot_id ? 'a hub' : 'a vehicle')}
                          {t.eway_part_b_required && !t.eway_part_b_ref ? ' · Part B due' : ''}
                        </span>
                      </span>
                      <StatusPill status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Claims" />
            {kase.claims.length === 0 ? (
              <EmptyState compact icon={<FileText size={22} />} title="No claims" description={actions.includes('raise_claim') ? 'Raise one if goods were lost or damaged.' : undefined} />
            ) : (
              <ul className="divide-y divide-border">
                {kase.claims.map((c: ClaimSummary) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setOpenClaimId(c.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-surface-subtle sm:px-6">
                      <span className="min-w-0">
                        <span className="block font-mono font-medium text-text">{c.code}</span>
                        <span className="block text-xs text-muted">{claimTypeLabel(c.claim_type)} · {formatRupees(c.claimed_amount)}</span>
                      </span>
                      <StatusPill status={c.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          <section className="space-y-3" aria-labelledby="goods-heading">
            <h2 id="goods-heading" className="text-lg font-semibold text-text">Affected consignments</h2>
            <DataTable
              caption={`Consignments in ${kase.code}`}
              columns={itemColumns}
              rows={kase.items}
              rowKey={i => i.id}
              pageSize={10}
              empty={{ title: 'No consignment on this case', description: 'The case is about the vehicle or route only.' }}
            />
          </section>

          <Card className="overflow-hidden">
            <CardHeader
              title="Vehicle and relief"
              description={canTransship ? 'Nearest operating vehicles with free space, ranked by distance, then free capacity and cargo type.' : 'Where the case is.'}
            />
            <div className="relative h-80 border-b border-border">
              <MapView
                mode="incident"
                vehicles={mapVehicles}
                points={mapPoints}
                selectedId={pickedRelief}
                onSelect={idPicked => setPickedRelief(idPicked !== kase.vehicle_id && idPicked !== 'case' ? idPicked : null)}
                showLabels
                ariaLabel={`Map of ${kase.code} and relief vehicles`}
              />
              {mapVehicles.length === 0 && mapPoints.length === 0 && (
                <p className="pointer-events-none absolute inset-x-3 bottom-3 z-10 rounded-control border border-border bg-surface px-3 py-2 text-sm text-muted shadow-raised">
                  No position was recorded for this case.
                </p>
              )}
            </div>
            {canTransship && (
              <CardBody>
                {relief.isLoading ? (
                  <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
                ) : relief.isError ? (
                  <ErrorState compact title="We could not load relief vehicles" onRetry={() => relief.refetch()} />
                ) : (relief.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted">No operating, approved vehicle with enough free space was found nearby.</p>
                ) : (
                  <ol className="divide-y divide-border">
                    {(relief.data ?? []).slice(0, 5).map((r, i) => (
                      <li key={r.vehicle.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="min-w-0 text-sm">
                          <span className="font-mono font-medium text-text">{i + 1}. {r.vehicle.plate_number}</span>
                          <span className="text-muted"> · {r.distance_km.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km · {formatKg(r.free_kg)} free{r.eta_minutes ? ` · ${Math.round(r.eta_minutes)} min away` : ''}</span>
                        </span>
                        <Button
                          size="sm"
                          variant={pickedRelief === r.vehicle.id ? 'primary' : 'secondary'}
                          onClick={() => setAction({ name: 'transship', preset: { to_vehicle_id: r.vehicle.id } })}
                        >
                          Transship
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Timeline" description="Handovers, SOS, maintenance, actions and notes, oldest first" />
            <CardBody>
              {kase.timeline.length === 0
                ? <p className="text-sm text-muted">Nothing recorded yet.</p>
                : <CaseTimeline entries={kase.timeline} />}
            </CardBody>
          </Card>
        </div>
      </div>

      {action && (
        <ExceptionActionModal
          key={`${action.name}-${action.preset?.to_vehicle_id ?? ''}`}
          kase={kase}
          action={action.name}
          preset={action.preset}
          reliefVehicles={relief}
          onClose={() => setAction(null)}
        />
      )}
      {assigning && <AssignOwnerModal kase={kase} onClose={() => setAssigning(false)} />}
      <ClaimDrawerById id={openClaimId} onClose={() => setOpenClaimId(null)} />
    </Page>
  )
}

interface StaffUser { id: string; full_name: string | null; email: string | null; role: string | null; is_active?: boolean | null }

function AssignOwnerModal({ kase, onClose }: { kase: ExceptionDetail; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [ownerId, setOwnerId] = useState(kase.owner_id ?? '')
  const [error, setError] = useState('')
  const staff = useQuery({
    queryKey: ['users', 'staff'],
    queryFn: async () => {
      const rows = (await usersAPI.list()) as StaffUser[]
      return (Array.isArray(rows) ? rows : [])
        .filter(u => ['admin', 'superadmin', 'manager'].includes(u.role ?? '') && u.is_active !== false)
        .sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''))
    },
  })
  const save = useMutation({
    mutationFn: () => exceptionsAPI.act(kase.id, { action: 'assign_owner', owner_id: ownerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
      toast.success('Owner changed')
      onClose()
    },
    onError: err => setError(errorMessage(err, 'We could not change the owner. Try again.')),
  })
  const submit = () => {
    if (!ownerId) { setError('Choose who owns the case.'); return }
    setError('')
    save.mutate()
  }
  return (
    <Modal
      open
      onClose={onClose}
      onSubmit={submit}
      size="sm"
      title={`Assign ${kase.code}`}
      description="The owner is told and gets the escalations when the deadline passes."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={staff.isLoading}>Assign</Button></>}
    >
      {staff.isError ? (
        <ErrorState compact title="We could not load the staff list" onRetry={() => staff.refetch()} />
      ) : (
        <Select
          label="Owner"
          value={ownerId}
          onChange={e => setOwnerId(e.target.value)}
          placeholder={staff.isLoading ? 'Loading…' : 'Choose a person'}
          disabled={staff.isLoading}
          options={(staff.data ?? []).map(u => ({ value: u.id, label: u.full_name || u.email || 'Unnamed' }))}
          error={error}
          required
        />
      )}
    </Modal>
  )
}
