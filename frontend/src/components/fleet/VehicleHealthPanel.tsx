import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Pencil, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { formatDate, formatRupees } from '@/utils/display'
import { Alert, Button, IconButton, Skeleton, StatusPill, useConfirm } from '@/components/ui'
import {
  apiErrorMessage, bandLabel, bandTone, checkLabel, checkTone, fleetKeys, formatOdometer, serviceLabel, serviceTone,
  type ServiceItem, type ServiceLogEntry, type VehicleHealth,
} from './health'
import { LogServiceModal, OdometerModal, PlanModal } from './ServiceModals'

/** Health score, odometer, service schedule and service history for one vehicle, shown in the Fleet drawer. */
export default function VehicleHealthPanel({ vehicleId, plate }: { vehicleId: string; plate: string }) {
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const [odometerOpen, setOdometerOpen] = useState(false)
  const [planEditor, setPlanEditor] = useState<{ plan: ServiceItem | null } | null>(null)
  const [logger, setLogger] = useState<{ item?: string } | null>(null)

  const health = useQuery<VehicleHealth>({
    queryKey: ['fleet-vehicle-health', vehicleId],
    queryFn: () => fleetAPI.vehicleHealth(vehicleId) as Promise<VehicleHealth>,
  })
  const log = useQuery<ServiceLogEntry[]>({
    queryKey: fleetKeys.log(vehicleId),
    queryFn: () => fleetAPI.serviceLog(vehicleId) as Promise<ServiceLogEntry[]>,
  })

  const removePlan = useMutation({
    mutationFn: (planId: string) => fleetAPI.deletePlan(planId),
    onSuccess: () => {
      toast.success('Service item removed')
      queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-health', vehicleId] })
      queryClient.invalidateQueries({ queryKey: fleetKeys.health })
      queryClient.invalidateQueries({ queryKey: fleetKeys.serviceDue })
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not remove this item. Try again.')),
  })

  const onRemove = async (plan: ServiceItem) => {
    const ok = await confirm({
      title: `Remove ${plan.item}?`,
      message: 'It stops being tracked for this vehicle. Past service records stay.',
      confirmLabel: 'Remove item',
      tone: 'danger',
    })
    if (ok) removePlan.mutate(plan.id)
  }

  if (health.isLoading) return <Skeleton className="h-48 w-full" />
  if (health.isError || !health.data) {
    return (
      <Alert tone="danger" title="We could not load this vehicle's health" action={<Button size="sm" variant="secondary" onClick={() => health.refetch()}>Try again</Button>}>
        Check your connection and try again.
      </Alert>
    )
  }
  const h = health.data

  return (
    <div className="space-y-6">
      <section aria-labelledby={`health-${vehicleId}`} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`health-${vehicleId}`} className="text-base font-semibold text-text">Health</h3>
          <StatusPill tone={bandTone[h.band]}>{bandLabel[h.band]}</StatusPill>
        </div>
        <div className="flex items-end gap-2">
          <p className="text-3xl font-semibold tabular text-text">{h.score ?? '—'}</p>
          <p className="pb-1 text-sm text-muted">
            {h.score == null ? 'Nothing to score yet' : `out of 100, from ${h.checks_known} of ${h.checks.length} checks`}
          </p>
        </div>
        <ul className="divide-y divide-border rounded-card border border-border">
          {h.checks.map(c => (
            <li key={c.key} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{c.label}</p>
                <p className="text-sm text-muted">{c.detail}</p>
              </div>
              <StatusPill tone={checkTone[c.state]} className="shrink-0">{checkLabel[c.state]}</StatusPill>
            </li>
          ))}
        </ul>
        {h.issues.length > 0 && (
          <ul className="space-y-1 text-sm">
            {h.issues.map(i => (
              <li key={i.text} className={i.severity === 'critical' ? 'text-danger' : 'text-warning'}>{i.text}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`odo-${vehicleId}`} className="flex items-center justify-between gap-3 rounded-card border border-border px-3 py-2.5">
        <div>
          <h3 id={`odo-${vehicleId}`} className="text-sm font-medium text-text">Odometer</h3>
          <p className="text-lg font-semibold tabular text-text">{formatOdometer(h.odometer_km)}</p>
          <p className="text-xs text-muted">
            {h.odometer_km == null
              ? 'Not known yet. It fills in from GPS once the vehicle drives, or enter the dashboard reading.'
              : 'Counted from GPS distance. Correct it to match the dashboard.'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOdometerOpen(true)}>Correct</Button>
      </section>

      <section aria-labelledby={`svc-${vehicleId}`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`svc-${vehicleId}`} className="text-base font-semibold text-text">Service schedule</h3>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setPlanEditor({ plan: null })}>Add item</Button>
            <Button size="sm" icon={<ClipboardCheck size={14} />} onClick={() => setLogger({})}>Log service</Button>
          </div>
        </div>
        {h.service.length === 0 ? (
          <p className="rounded-card border border-dashed border-border px-3 py-4 text-sm text-muted">
            No service items yet. Add engine oil, brakes, tyres or a general service to see when each is due.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border">
            {h.service.map(p => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{p.item}</p>
                  <p className="text-sm text-muted">{p.summary}</p>
                  <p className="text-xs text-muted">
                    {[p.interval_km != null && `Every ${p.interval_km.toLocaleString('en-IN')} km`, p.interval_days != null && `every ${p.interval_days} days`]
                      .filter(Boolean).join(' or ')}
                    {p.last_done_at ? `. Last done ${formatDate(p.last_done_at)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <StatusPill tone={serviceTone[p.status]}>{serviceLabel[p.status]}</StatusPill>
                  <IconButton label={`Log ${p.item} as done`} icon={<ClipboardCheck size={16} />} size="sm" onClick={() => setLogger({ item: p.item })} />
                  <IconButton label={`Change ${p.item}`} icon={<Pencil size={16} />} size="sm" onClick={() => setPlanEditor({ plan: p })} />
                  <IconButton label={`Remove ${p.item}`} icon={<Trash2 size={16} />} size="sm" onClick={() => onRemove(p)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`hist-${vehicleId}`} className="space-y-3">
        <h3 id={`hist-${vehicleId}`} className="text-base font-semibold text-text">Service history</h3>
        {log.isLoading ? <Skeleton className="h-16 w-full" /> : (log.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing logged yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border">
            {(log.data ?? []).slice(0, 10).map(e => (
              <li key={e.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-text">{e.item}</p>
                  <p className="text-sm text-muted">{formatDate(e.done_at)}</p>
                </div>
                <p className="text-xs text-muted">
                  {[e.odometer_km != null && `At ${Math.round(Number(e.odometer_km)).toLocaleString('en-IN')} km`,
                    e.cost != null && formatRupees(e.cost), e.note].filter(Boolean).join(' · ') || 'No details'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {odometerOpen && <OdometerModal open vehicleId={vehicleId} plate={plate} current={h.odometer_km} onClose={() => setOdometerOpen(false)} />}
      {planEditor && <PlanModal open vehicleId={vehicleId} plan={planEditor.plan} onClose={() => setPlanEditor(null)} />}
      {logger && (
        <LogServiceModal
          open
          vehicleId={vehicleId}
          plate={plate}
          items={h.service.map(s => s.item)}
          odometer={h.odometer_km}
          presetItem={logger.item}
          onClose={() => setLogger(null)}
        />
      )}
    </div>
  )
}
