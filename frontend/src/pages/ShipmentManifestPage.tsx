import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Pencil, Printer } from 'lucide-react'
import {
  Button, Card, CardBody, CardHeader, Checkbox, DetailList, ErrorState, Input, LoadingState, Page, PageHeader, StatusPill,
  Textarea, humanize,
} from '@/components/ui'
import { shipmentsAPI } from '@/services/api'
import { apiErrorMessage, formatDate, formatKg, formatRupees, haversineKm } from '@/components/shipments/format'
import { emailError, indianMobileError } from '@/utils/validators'

type Meta = Record<string, unknown>

interface ManifestPoint {
  name?: string | null
  address?: string | null
  phone?: string | null
  contact_number?: string | null
  email?: string | null
  latitude?: number | null
  longitude?: number | null
  lat?: number | null
  lng?: number | null
}

/** GET /shipments/:id also resolves vendor requests and cargo manifests, so most fields are optional. */
interface ManifestShipment {
  id: string
  tracking_id: string
  status?: string | null
  metadata?: Meta | null
  created_at?: string | null
  origin_address?: string | null
  origin_lat?: number | null
  origin_lng?: number | null
  dest_name?: string | null
  dest_address?: string | null
  dest_lat?: number | null
  dest_lng?: number | null
  total_items?: number | null
  total_weight_kg?: number | null
  asking_price?: number | null
  pickup_location?: ManifestPoint | null
  drop_location?: ManifestPoint | null
  delivery_points?: ManifestPoint[]
  delivery_point?: ManifestPoint | null
  parcels?: { category?: string | null }[]
  customer?: { name?: string | null; phone?: string | null; email?: string | null } | null
}

const HANDLING_FLAGS = [
  { key: 'fragile', label: 'Fragile' },
  { key: 'hazardous', label: 'Hazardous' },
  { key: 'coldChain', label: 'Cold chain (temperature controlled)' },
  { key: 'stackable', label: 'Stackable' },
  { key: 'highValue', label: 'High value' },
  { key: 'longHaul', label: 'Long haul' },
] as const

const text = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

function getPath(obj: Meta, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Meta)[key] : undefined), obj)
}

function setPath(obj: Meta, path: string, value: unknown): Meta {
  const [key, ...rest] = path.split('.')
  if (rest.length === 0) return { ...obj, [key]: value }
  const child = obj[key] && typeof obj[key] === 'object' ? (obj[key] as Meta) : {}
  return { ...obj, [key]: setPath(child, rest.join('.'), value) }
}

/** Straight-line distance from the pickup through each drop, in km. */
function routeDistanceKm(s: ManifestShipment, points: ManifestPoint[]) {
  if (!s.origin_lat || !s.origin_lng) return null
  let lat = s.origin_lat
  let lng = s.origin_lng
  let total = 0
  const drops = points.length > 0 ? points : [{ lat: s.drop_location?.lat ?? s.dest_lat, lng: s.drop_location?.lng ?? s.dest_lng }]
  for (const p of drops) {
    const pLat = p.latitude ?? p.lat
    const pLng = p.longitude ?? p.lng
    if (!pLat || !pLng) continue
    total += haversineKm(lat, lng, pLat, pLng)
    lat = pLat
    lng = pLng
  }
  return total > 0 ? total : null
}

interface FieldDef {
  path: string
  label: string
  value: string | null
  type?: 'text' | 'date' | 'email' | 'tel'
  mono?: boolean
  error?: string
}

export default function ShipmentManifestPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Meta>({})

  const { data: shipment, isLoading, isError, refetch } = useQuery<ManifestShipment>({
    queryKey: ['shipment', id],
    queryFn: () => shipmentsAPI.get(id!),
    enabled: !!id,
  })

  const save = useMutation({
    mutationFn: (metadata: Meta) => shipmentsAPI.updateMetadata(id!, metadata),
    onSuccess: () => {
      toast.success('Manifest saved')
      queryClient.invalidateQueries({ queryKey: ['shipment', id] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      setEditing(false)
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not save the manifest. Try again.')),
  })

  const back = { to: '/shipments', label: 'Shipments' }

  if (isLoading) {
    return (
      <Page>
        <PageHeader back={back} title="Manifest" />
        <LoadingState label="Loading manifest" />
      </Page>
    )
  }

  if (isError || !shipment) {
    return (
      <Page>
        <PageHeader back={back} title="Manifest" />
        <Card>
          <ErrorState
            title="We could not load this manifest"
            description="Check your connection and try again. If the shipment was deleted, go back to Shipments."
            onRetry={() => refetch()}
          />
        </Card>
      </Page>
    )
  }

  const saved: Meta = shipment.metadata ?? {}
  const meta = editing ? draft : saved

  const points = shipment.delivery_points?.length
    ? shipment.delivery_points
    : (shipment.delivery_point ? [shipment.delivery_point] : [])
  const drop: ManifestPoint | null = points.length > 0 ? points[points.length - 1] : (shipment.drop_location ?? null)

  const distance = routeDistanceKm(shipment, points)
  const estimatedArrival = distance
    ? (() => {
      const d = new Date(shipment.created_at || Date.now())
      d.setHours(d.getHours() + distance / 40)
      return `${d.toISOString().split('T')[0]} (Est.)`
    })()
    : null

  // Values saved on the manifest win; otherwise show what the shipment itself records.
  const pick = (path: string, fallback: string | null) => {
    const v = getPath(meta, path)
    if (editing) return v === undefined ? fallback : text(v)
    return text(v) ?? fallback
  }

  const consigneeContact = pick('consigneeContact', text(drop?.phone ?? drop?.contact_number ?? shipment.customer?.phone))
  const consigneeEmail = pick('consigneeEmail', text(drop?.email ?? shipment.customer?.email))
  const consignee: FieldDef[] = [
    { path: 'consigneeName', label: 'Name', value: pick('consigneeName', text(drop?.name ?? shipment.dest_name ?? shipment.customer?.name)) },
    {
      path: 'consigneeContact', label: 'Phone', type: 'tel', value: consigneeContact,
      error: editing ? indianMobileError(consigneeContact ?? '') : undefined,
    },
    {
      path: 'consigneeEmail', label: 'Email', type: 'email', value: consigneeEmail,
      error: editing ? emailError(consigneeEmail ?? '') : undefined,
    },
  ]
  const trip: FieldDef[] = [
    { path: 'dispatch_date', label: 'Dispatch date', type: 'date', value: pick('dispatch_date', shipment.created_at ? shipment.created_at.split('T')[0] : null) },
    { path: 'reporting_date', label: 'Reporting date', type: 'date', value: pick('reporting_date', null) },
    { path: 'eta_details.eta_text', label: 'Estimated arrival', value: pick('eta_details.eta_text', estimatedArrival) },
    { path: 'eta_details.distance_km', label: 'Distance (km)', value: pick('eta_details.distance_km', distance ? distance.toFixed(1) : null) },
  ]
  const category = shipment.parcels?.[0]?.category
  const cargo: FieldDef[] = [
    { path: 'productCategory', label: 'Product category', value: pick('productCategory', category ? humanize(category) : null) },
    { path: 'productName', label: 'Product name', value: pick('productName', null) },
    { path: 'brand', label: 'Brand or make', value: pick('brand', null) },
    { path: 'packagingType', label: 'Packaging', value: pick('packagingType', null) },
    { path: 'noOfPackages', label: 'Packages', value: pick('noOfPackages', shipment.total_items != null ? String(shipment.total_items) : null) },
    { path: 'grossWeight', label: 'Gross weight', value: pick('grossWeight', formatKg(shipment.total_weight_kg)) },
    { path: 'declaredValue', label: 'Declared value', value: pick('declaredValue', formatRupees(shipment.asking_price)) },
  ]

  const handling = (getPath(meta, 'specialHandling') as Meta | undefined) ?? {}
  const activeFlags = HANDLING_FLAGS.filter(f => handling[f.key])
  const remarks = text(meta.remarks)
  const transporterSignature = text(saved.transporter_signature)

  const change = (path: string, value: unknown) => setDraft(prev => setPath(prev, path, value))

  const renderFields = (fields: FieldDef[], columns: 1 | 2 | 3 = 2) => editing ? (
    <div className={columns === 1 ? 'grid gap-4' : columns === 3 ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-4 sm:grid-cols-2'}>
      {fields.map(f => (
        <Input
          key={f.path}
          label={f.label}
          type={f.type ?? 'text'}
          value={f.value ?? ''}
          onChange={e => change(f.path, e.target.value)}
          error={f.error}
        />
      ))}
    </div>
  ) : (
    <DetailList columns={columns} items={fields.map(f => ({ label: f.label, value: f.value }))} />
  )

  const startEdit = () => { setDraft(saved); setEditing(true) }

  const fieldError = consignee.find(f => f.error)?.error
  const handleSave = () => {
    if (fieldError) { toast.error(fieldError); return }
    save.mutate(draft)
  }

  const actions = editing ? (
    <>
      <Button variant="secondary" onClick={() => setEditing(false)} disabled={save.isPending}>Cancel</Button>
      <Button onClick={handleSave} loading={save.isPending} disabled={!!fieldError}>Save changes</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" icon={<Printer size={16} />} onClick={() => window.print()}>Print</Button>
      <Button icon={<Pencil size={16} />} onClick={startEdit}>Edit manifest</Button>
    </>
  )

  return (
    <Page>
      <PageHeader
        back={back}
        title="Manifest"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono text-text">{shipment.tracking_id}</span>
            {shipment.status && <StatusPill status={shipment.status} />}
          </span>
        }
        actions={<div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ManifestCard title="Consignor">
          <DetailList
            columns={1}
            items={[{ label: 'Pickup address', value: text(shipment.pickup_location?.address ?? shipment.origin_address) }]}
          />
          {editing && <p className="mt-3 text-xs text-muted">The pickup comes from the shipment's route and cannot be changed here.</p>}
        </ManifestCard>
        <ManifestCard title="Consignee">
          <div className="space-y-4">
            {renderFields(consignee, 1)}
            <DetailList
              columns={1}
              items={[{ label: 'Delivery address', value: text(drop?.address ?? shipment.drop_location?.address ?? shipment.dest_address) }]}
            />
          </div>
        </ManifestCard>
      </div>

      <ManifestCard title="Trip" description={editing ? undefined : 'Arrival and distance are estimates unless entered on the manifest.'}>
        {renderFields(trip, 2)}
      </ManifestCard>

      <ManifestCard title="Cargo">{renderFields(cargo, 3)}</ManifestCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ManifestCard title="Special handling">
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {HANDLING_FLAGS.map(f => (
                <Checkbox
                  key={f.key}
                  label={f.label}
                  checked={!!handling[f.key]}
                  onChange={e => change(`specialHandling.${f.key}`, e.target.checked)}
                />
              ))}
            </div>
          ) : activeFlags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activeFlags.map(f => <StatusPill key={f.key} tone={f.key === 'hazardous' ? 'danger' : 'neutral'} dot={false}>{f.label}</StatusPill>)}
            </div>
          ) : (
            <p className="text-sm text-muted">No special handling.</p>
          )}
        </ManifestCard>
        <ManifestCard title="Remarks">
          {editing ? (
            <Textarea
              label="Remarks and instructions"
              hideLabel
              rows={4}
              placeholder="Anything the transporter or consignee should know"
              value={remarks ?? ''}
              onChange={e => change('remarks', e.target.value)}
            />
          ) : (
            <p className="whitespace-pre-line text-sm text-text">{remarks ?? <span className="text-muted">No remarks.</span>}</p>
          )}
        </ManifestCard>
      </div>

      <ManifestCard title="Signatures">
        <div className="grid gap-6 sm:grid-cols-3">
          <SignatureLine label="Consignor" />
          <SignatureLine label="Transporter" value={transporterSignature} />
          <SignatureLine label="Consignee" hint="Signed on delivery" />
        </div>
      </ManifestCard>

      <p className="text-xs text-muted">
        Printed from MargixIndia on {formatDate(new Date().toISOString())}. Reference <span className="font-mono">{shipment.id}</span>.
      </p>
    </Page>
  )
}

function ManifestCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

function SignatureLine({ label, value, hint }: { label: string; value?: string | null; hint?: string }) {
  return (
    <div>
      <div className="flex h-12 items-end border-b border-border-strong pb-1 text-sm text-text">{value}</div>
      <p className="mt-2 text-sm font-medium text-text">{label}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}
