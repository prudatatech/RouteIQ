import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRightLeft, Ban, MapPinOff } from 'lucide-react'
import { MapView, type MapPoint, type MapVehicle } from '@/components/map'
import {
  Alert, Button, Card, CardBody, CardHeader, DataTable, DetailList, EmptyState, ErrorState, Input, Page, PageHeader, Skeleton, StatusPill,
  buttonClasses, useConfirm, type Column,
} from '@/components/ui'
import { ConditionPill, ConsignmentLink, Steps } from '@/components/cargo/CargoBits'
import { isActiveTransfer, partBDue, positionOf, transferItemCount, transferSteps } from '@/components/cargo/logic'
import { cargoKeys, transfersAPI, type CargoTransfer, type CargoVehicle, type TransferItem } from '@/services/cargo'
import { EWAY_BILL_PORTAL_URL } from '@/config/compliance'
import { isNotFoundError, errorMessage, formatDateTime, formatPieces } from '@/utils/display'

const EWAY_REF = /^[A-Za-z0-9-]{6,40}$/
const n = (x: number) => x.toLocaleString('en-IN')


function vehicleText(v: CargoVehicle | null | undefined): string {
  if (!v) return '—'
  return v.driver_name ? `${v.plate_number}, driver ${v.driver_name}` : v.plate_number
}

function mapVehicle(v: CargoVehicle | null | undefined): MapVehicle | null {
  const position = positionOf(v)
  if (!v || !position) return null
  return { id: v.id, position, status: v.status || 'on_route', label: v.plate_number, vehicle_type: v.vehicle_type }
}

export default function TransferPage() {
  const { id = '' } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { prompt } = useConfirm()
  const [ref, setRef] = useState('')
  const [touched, setTouched] = useState(false)

  const query = useQuery<CargoTransfer>({
    queryKey: cargoKeys.transfer(id),
    queryFn: () => transfersAPI.get(id),
    enabled: !!id,
    refetchInterval: 30_000,
    retry: (count, err) => !isNotFoundError(err) && count < 2,
  })

  const done = (message: string) => {
    toast.success(message)
    queryClient.invalidateQueries({ queryKey: cargoKeys.all })
  }
  const cancelMutation = useMutation({
    mutationFn: (reason: string) => transfersAPI.cancel(id, reason),
    onSuccess: () => done('Transfer cancelled'),
    onError: err => toast.error(errorMessage(err, 'We could not cancel this transfer.')),
  })
  const ewayMutation = useMutation({
    mutationFn: (value: string) => transfersAPI.recordEway(id, value),
    onSuccess: () => { setRef(''); setTouched(false); done('E-way bill reference saved') },
    onError: err => toast.error(errorMessage(err, 'We could not save the e-way bill reference.')),
  })

  const back = { to: '/cargo?tab=transfers', label: 'Transfers' }

  if (query.isLoading) {
    return (
      <Page>
        <PageHeader title={<Skeleton className="h-8 w-48" />} back={back} />
        <Skeleton className="h-64 w-full" />
      </Page>
    )
  }
  const t = query.data
  if (!t) {
    return (
      <Page>
        <PageHeader title="Transfer" back={back} />
        {isNotFoundError(query.error) || !query.isError ? (
          <EmptyState
            icon={<ArrowRightLeft size={22} />}
            title="We could not find this transfer"
            description="It may have been removed. Go back to the transfers list to pick another one."
            action={<Link to="/cargo?tab=transfers" className={buttonClasses({ variant: 'secondary' })}>Back to transfers</Link>}
          />
        ) : (
          <ErrorState title="We could not load this transfer" description="Check your connection and try again." onRetry={() => query.refetch()} />
        )}
      </Page>
    )
  }

  const items = t.items
  const mismatches = items.filter(i => transferItemCount(i).mismatch).length
  const shortPieces = items.reduce((total, i) => total + Math.max(0, transferItemCount(i).gap), 0)
  const sum = (pick: (i: TransferItem) => number | null) => items.reduce((total, i) => total + (pick(i) ?? 0), 0)
  const anyOut = items.some(i => i.pieces_out != null)
  const anyIn = items.some(i => i.pieces_in != null)

  const destination = t.to_vehicle?.plate_number ?? t.to_depot?.name ?? 'a hub'
  const canCancel = isActiveTransfer(t.status)

  const cancel = async () => {
    const reason = await prompt({
      title: `Cancel transfer ${t.code}?`,
      message: 'The goods stay on the first vehicle and the drivers are told the move is off.',
      inputLabel: 'Reason',
      required: true,
      tone: 'danger',
      confirmLabel: 'Cancel transfer',
      cancelLabel: 'Keep transfer',
    })
    if (reason) cancelMutation.mutate(reason.trim())
  }

  // Map: meeting point, both vehicles, and the depot.
  const meet = positionOf({ lat: t.meet_lat, lng: t.meet_lng })
  const depot = positionOf(t.to_depot)
  const points: MapPoint[] = [
    ...(meet ? [{ id: 'meet', kind: 'location' as const, position: meet, label: t.meet_address || 'Meeting point' }] : []),
    ...(depot && t.to_depot ? [{ id: `depot-${t.to_depot.id}`, kind: 'hub' as const, position: depot, label: t.to_depot.name }] : []),
  ]
  const vehicles = [mapVehicle(t.from_vehicle), mapVehicle(t.to_vehicle)].filter((v): v is MapVehicle => v != null)
  const hasMap = points.length > 0 || vehicles.length > 0

  const refError = !ref.trim()
    ? 'Enter the new Part B reference.'
    : !EWAY_REF.test(ref.trim()) ? 'Use 6 to 40 letters, digits or dashes.' : undefined
  const submitEway = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!refError) ewayMutation.mutate(ref.trim())
  }

  const columns: Column<TransferItem>[] = [
    { key: 'consignment', header: 'Shipment', cell: i => <ConsignmentLink c={i} /> },
    { key: 'planned', header: 'Planned', align: 'right', cell: i => <span className="tabular">{n(i.pieces_planned)}</span> },
    {
      key: 'out', header: 'Out', align: 'right',
      cell: i => {
        const c = transferItemCount(i)
        return <span className={c.mismatch ? 'tabular text-danger' : 'tabular'}>{c.out == null ? '—' : n(c.out)}</span>
      },
    },
    {
      key: 'in', header: 'In', align: 'right',
      cell: i => {
        const c = transferItemCount(i)
        return <span className={c.mismatch ? 'tabular text-danger' : 'tabular'}>{c.in == null ? '—' : n(c.in)}</span>
      },
    },
    { key: 'condition', header: 'Condition in', hideBelow: 'md', cell: i => <ConditionPill condition={i.condition_in} /> },
    {
      key: 'check', header: 'Check',
      cell: i => {
        const c = transferItemCount(i)
        if (c.mismatch) {
          return (
            <span className="inline-flex flex-col items-start gap-1">
              <StatusPill tone="danger">Does not match</StatusPill>
              {c.note && <span className="text-xs text-danger">{c.note}</span>}
            </span>
          )
        }
        if (c.out == null) return <span className="text-muted">Not handed over yet</span>
        if (c.in == null) return <span className="text-muted">Waiting for the receiver’s count</span>
        return <StatusPill tone="success">Matches</StatusPill>
      },
    },
  ]

  return (
    <Page>
      <PageHeader
        back={back}
        title={<span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-3"><span className="min-w-0 break-all font-mono">{t.code}</span><StatusPill status={t.status} /></span>}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>From {t.from_vehicle?.plate_number ?? 'the first vehicle'} to {destination}</span>
            {t.exception_id && (
              <>
                <span aria-hidden="true">·</span>
                <span>Case <Link to={`/cargo/exceptions/${t.exception_id}`} className="font-mono text-brand hover:underline">{t.exception?.code ?? 'Open case'}</Link></span>
              </>
            )}
          </span>
        }
        actions={canCancel ? (
          <Button variant="danger" icon={<Ban size={16} />} loading={cancelMutation.isPending} onClick={cancel}>Cancel transfer</Button>
        ) : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Progress" />
            <CardBody className="space-y-4">
              <Steps steps={transferSteps(t)} label="Transfer progress" />
              <DetailList
                columns={3}
                items={[
                  { label: 'Planned', value: t.planned_at ? formatDateTime(t.planned_at) : 'Not set' },
                  { label: 'Started', value: t.started_at ? formatDateTime(t.started_at) : 'Not yet' },
                  ...(t.status === 'cancelled' ? [] : [{ label: 'Completed', value: t.completed_at ? formatDateTime(t.completed_at) : 'Not yet' }]),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Shipments" description="What was planned, handed over and received" />
            <CardBody className="space-y-4">
              {mismatches > 0 && t.status === 'completed' ? (
                <Alert tone="info" title={shortPieces > 0 ? `${formatPieces(shortPieces)} short on arrival` : 'Counts differed'}>
                  {shortPieces > 0 ? 'A shortage problem was opened for it. ' : ''}
                  <Link to="/cargo" className="font-medium underline">Open Problems</Link>
                </Alert>
              ) : mismatches > 0 && (
                <Alert tone="danger" title="Counts do not match">
                  {mismatches === 1 ? '1 shipment does not match' : `${mismatches} shipments do not match`}: a shortage problem opens when fewer pieces arrive than were handed over.
                </Alert>
              )}
              <p className="text-sm text-muted">
                Planned <span className="tabular font-medium text-text">{n(sum(i => i.pieces_planned))}</span>
                {' · '}Out <span className="tabular font-medium text-text">{anyOut ? n(sum(i => i.pieces_out)) : '—'}</span>
                {' · '}In <span className="tabular font-medium text-text">{anyIn ? n(sum(i => i.pieces_in)) : '—'}</span> pieces
              </p>
              <DataTable
                caption="Shipments in this transfer"
                columns={columns}
                rows={items}
                rowKey={i => i.id}
                pageSize={50}
                empty={{ title: 'No shipments', description: 'This transfer has no shipments on it.' }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Meeting point" description={t.meet_address || undefined} />
            <CardBody>
              {hasMap ? (
                <MapView mode="route" height={320} vehicles={vehicles} points={points} ariaLabel="Map of the transfer meeting point and vehicles" />
              ) : (
                <EmptyState compact icon={<MapPinOff size={22} />} title="No meeting point on the map" description="Neither the meeting point nor the vehicles have a position yet." />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader
              title="E-way bill"
              description="Update the vehicle number on the e-way bill (Part B) when the goods change vehicle"
              actions={<a href={EWAY_BILL_PORTAL_URL} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand hover:underline">Open the e-way bill portal</a>}
            />
            <CardBody className="space-y-4">
              {partBDue(t) ? (
                <>
                  <Alert tone="warning" title="E-way bill Part B update required">
                    The goods moved to a different vehicle. Update Part B with the new vehicle number on the e-way bill portal, then save the new reference here.
                  </Alert>
                  <form onSubmit={submitEway} noValidate className="space-y-3">
                    <Input
                      label="New Part B reference"
                      required
                      value={ref}
                      onChange={e => setRef(e.target.value)}
                      onBlur={() => setTouched(true)}
                      error={touched ? refError : undefined}
                      maxLength={40}
                      autoComplete="off"
                      inputClassName="font-mono"
                    />
                    <Button type="submit" size="sm" loading={ewayMutation.isPending}>Save reference</Button>
                  </form>
                </>
              ) : t.eway_part_b_ref ? (
                <DetailList
                  columns={1}
                  items={[
                    { label: 'Part B reference', value: <span className="font-mono">{t.eway_part_b_ref}</span> },
                    { label: 'Updated', value: t.eway_part_b_updated_at ? formatDateTime(t.eway_part_b_updated_at) : '—' },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">
                  No e-way bill change needed{t.to_depot ? ' (the goods go to a hub, not another vehicle).' : ' (the goods stay on the same vehicle).'}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  { label: 'From vehicle', value: vehicleText(t.from_vehicle) },
                  { label: t.to_depot && !t.to_vehicle ? 'To hub' : 'To vehicle', value: t.to_vehicle ? vehicleText(t.to_vehicle) : (t.to_depot?.name ?? '—') },
                  { label: 'Note', value: t.note || 'No note' },
                  { label: 'Planned', value: t.planned_at ? formatDateTime(t.planned_at) : '—' },
                  {
                    label: 'New trip',
                    value: t.new_route_id ? <Link to={`/routes/${t.new_route_id}`} className="text-brand hover:underline">Open the new trip</Link> : 'None',
                  },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </Page>
  )
}
