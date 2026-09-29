import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Gauge, Pencil, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { formatDate, formatRelative } from '@/utils/display'
import { Alert, Button, IconButton, Skeleton, StatusPill, useConfirm } from '@/components/ui'
import { apiErrorMessage, formatOdometer, type ServiceItem } from '../health'
import { OdometerModal, PlanModal } from '../ServiceModals'
import { documentBar, DOCUMENT_FIELDS, odometerNote, serviceBar, type ConditionBar, type ConditionState } from './condition'
import { LogServiceModal } from './LogServiceModal'
import { useRefreshVehicle } from './useRefreshVehicle'
import { maintenanceKeys, type ConditionVehicle, type OdometerSyncResult } from './types'

const fillClass: Record<ConditionState, string> = {
  ok: 'bg-success', watch: 'bg-warning', urgent: 'bg-danger', overdue: 'bg-danger', unknown: 'bg-neutral',
}
const textClass: Record<ConditionState, string> = {
  ok: 'text-success', watch: 'text-warning', urgent: 'text-danger', overdue: 'text-danger', unknown: 'text-muted',
}

/** One coloured progress bar: how much is left before it is due. */
function Bar({ bar, actions }: { bar: ConditionBar; actions?: React.ReactNode }) {
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium text-text">{bar.label}</p>
        <div className="flex shrink-0 items-center gap-1">
          {bar.state === 'overdue' && <StatusPill tone="danger" dot={false}>Overdue</StatusPill>}
          {actions}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={`${bar.label}: ${bar.headline}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bar.fill * 100)}
        className="h-2 overflow-hidden rounded-full bg-neutral-soft"
      >
        <div className={`h-full rounded-full ${fillClass[bar.state]}`} style={{ width: `${bar.fill * 100}%` }} />
      </div>
      <p className="text-xs text-muted">
        <span className={`font-medium ${textClass[bar.state]}`}>{bar.headline}</span>
        {bar.detail ? ` · ${bar.detail}` : ''}
      </p>
    </li>
  )
}

/**
 * The vehicle's current condition: the odometer (with Auto sync), a coloured bar for each service item
 * (engine oil, brake pads, tyres, air filter, coolant, battery, clutch...) showing what runs out first,
 * days or km, and a bar for each document's expiry (RC, insurance, fitness, permit, PUC).
 * A vehicle with no service items can add the default ones in one click; each can then be changed for that vehicle.
 */
export function VehicleConditionCard({ vehicleId }: { vehicleId: string }) {
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const refresh = useRefreshVehicle(vehicleId)
  const [odometerOpen, setOdometerOpen] = useState(false)
  const [planEditor, setPlanEditor] = useState<{ plan: ServiceItem | null } | null>(null)
  const [logger, setLogger] = useState<{ item?: string } | null>(null)

  const vehicle = useQuery<ConditionVehicle>({
    queryKey: maintenanceKeys.vehicle(vehicleId),
    queryFn: () => fleetAPI.vehicle(vehicleId) as Promise<ConditionVehicle>,
  })
  const plans = useQuery<ServiceItem[]>({
    queryKey: maintenanceKeys.plans(vehicleId),
    queryFn: () => fleetAPI.servicePlans(vehicleId) as Promise<ServiceItem[]>,
  })

  const sync = useMutation({
    mutationFn: () => fleetAPI.syncOdometer(vehicleId) as Promise<OdometerSyncResult>,
    onSuccess: r => {
      if (r.changed) {
        const from = r.source === 'routes' ? 'completed routes' : 'GPS'
        toast.success(`Added ${r.added_km.toLocaleString('en-IN')} km from ${from}. Odometer is now ${formatOdometer(r.after_km)}.`)
      } else {
        toast(r.message)
      }
      refresh()
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not sync the odometer. Try again.')),
  })

  const addDefaults = useMutation({
    mutationFn: () => fleetAPI.addDefaultPlans(vehicleId),
    onSuccess: rows => {
      toast.success(`${rows.length} service ${rows.length === 1 ? 'item' : 'items'} added`)
      refresh()
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not add the default items. Try again.')),
  })

  const removePlan = useMutation({
    mutationFn: (planId: string) => fleetAPI.deletePlan(planId),
    onSuccess: () => { toast.success('Service item removed'); refresh() },
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

  if (vehicle.isLoading || plans.isLoading) return <Skeleton className="h-56 w-full" />
  if (vehicle.isError || plans.isError || !vehicle.data) {
    return (
      <Alert
        tone="danger"
        title="We could not load this vehicle's condition"
        action={<Button size="sm" variant="secondary" onClick={() => { vehicle.refetch(); plans.refetch() }}>Try again</Button>}
      >
        Check your connection and try again.
      </Alert>
    )
  }
  const v = vehicle.data
  const items = plans.data ?? []
  const docs = DOCUMENT_FIELDS.map(f => ({ f, bar: documentBar(f.key, f.label, v[f.key]) }))

  return (
    <section aria-label="Current condition" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">Current condition</h3>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setPlanEditor({ plan: null })}>Add item</Button>
          <Button size="sm" icon={<ClipboardCheck size={14} />} onClick={() => setLogger({})}>Log service</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-muted"><Gauge size={14} aria-hidden="true" />Odometer</p>
          <p className="text-lg font-semibold tabular text-text">{formatOdometer(v.odometer_km)}</p>
          <p className="text-xs text-muted">{odometerNote(v, formatRelative)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} loading={sync.isPending} onClick={() => sync.mutate()}>Auto sync</Button>
          <Button variant="secondary" size="sm" onClick={() => setOdometerOpen(true)}>Correct</Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-text">Service items</h4>
        {items.length === 0 ? (
          <div className="rounded-card border border-dashed border-border px-4 py-5 text-center">
            <p className="text-sm font-medium text-text">No service items yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              Add the usual ones (engine oil, brake pads, tyres, air filter, coolant, battery, clutch and more) in one click.
              Each starts from its last logged service, or from today. Change any of them for this vehicle afterwards.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button icon={<Wand2 size={16} />} loading={addDefaults.isPending} onClick={() => addDefaults.mutate()}>Add default items</Button>
              <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setPlanEditor({ plan: null })}>Add your own</Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border">
            {[...items]
              .map(p => ({ p, bar: serviceBar(p) }))
              .sort((a, b) => stateRank[b.bar.state] - stateRank[a.bar.state] || a.bar.label.localeCompare(b.bar.label))
              .map(({ p, bar }) => (
                <Bar
                  key={p.id}
                  bar={bar}
                  actions={(
                    <>
                      <IconButton label={`Log ${p.item} as done`} icon={<ClipboardCheck size={15} />} size="sm" onClick={() => setLogger({ item: p.item })} />
                      <IconButton label={`Change ${p.item} for this vehicle`} icon={<Pencil size={15} />} size="sm" onClick={() => setPlanEditor({ plan: p })} />
                      <IconButton label={`Remove ${p.item}`} icon={<Trash2 size={15} />} size="sm" onClick={() => onRemove(p)} />
                    </>
                  )}
                />
              ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-text">Documents</h4>
        <ul className="divide-y divide-border rounded-card border border-border">
          {docs.map(({ f, bar }) => (
            <Bar key={f.key} bar={{ ...bar, detail: v[f.key] ? `Expires ${formatDate(v[f.key])}` : null }} />
          ))}
        </ul>
        <p className="text-xs text-muted">Update a document's expiry date by editing the vehicle.</p>
      </div>

      {odometerOpen && (
        <OdometerModal open vehicleId={vehicleId} plate={v.plate_number} current={v.odometer_km} onClose={() => { setOdometerOpen(false); queryClient.invalidateQueries({ queryKey: maintenanceKeys.vehicle(vehicleId) }) }} />
      )}
      {planEditor && <PlanModal open vehicleId={vehicleId} plan={planEditor.plan} onClose={() => setPlanEditor(null)} />}
      {logger && (
        <LogServiceModal
          open
          vehicleId={vehicleId}
          plate={v.plate_number}
          items={items.map(i => i.item)}
          odometer={v.odometer_km}
          presetItem={logger.item}
          onClose={() => setLogger(null)}
        />
      )}
    </section>
  )
}

/** The worst bars first. */
const stateRank: Record<ConditionState, number> = { overdue: 4, urgent: 3, watch: 2, ok: 1, unknown: 0 }
