import { useQuery } from '@tanstack/react-query'
import { Alert, DetailList, Skeleton } from '@/components/ui'
import GstSummary from '@/components/load-post/GstSummary'
import { publicAPI, vendorAPI } from '@/services/api'
import { formatDate, formatKg, formatRupees } from '@/utils/display'
import type { LoadItem } from '@/types/load'
import { priorityLabel } from '@/components/load-post/logic'
import { specialHandlingLabels, taxFromItems, temperatureText, type PostedLoadFields } from './postedLoad'

const SLOT: Record<string, string> = { morning: 'Morning (6am–12pm)', afternoon: 'Afternoon (12pm–6pm)', evening: 'Evening (6pm–10pm)' }
const place = (address: string | null, city: string | null, pin: string | null) => [address, city, pin].filter(Boolean).join(', ') || null
const contact = (name: string | null, phone: string | null) => [name, phone].filter(Boolean).join(' · ') || null
const tonnes = (t: number | string | null) => (t == null || t === '' ? null : `${Number(t).toLocaleString('en-IN', { maximumFractionDigits: 2 })} t`)

const th = 'px-2 py-1.5 text-left text-xs font-medium text-muted'
const td = 'px-2 py-1.5 text-sm'

function Heading({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>
}

/**
 * Everything the vendor entered on the Post a Load form, for staff: the MRX number, the products with HSN, rate,
 * quantity, weight and value, the GST summary, the e-Way Bill flag, both addresses with their contacts and slots, and the
 * transport choices. The load's own columns come with the request; the goods lines are read from GET /vendor/loads/:id.
 */
export default function PostedLoadDetails({ request }: { request: { id: string } & Partial<PostedLoadFields> }) {
  const r = request
  const items = useQuery({
    queryKey: ['posted-load', request.id],
    queryFn: async () => (await vendorAPI.load(request.id)) as { items?: LoadItem[] },
    staleTime: 60_000,
    retry: false,
  })
  const classes = useQuery({ queryKey: ['public', 'vehicle-classes'], queryFn: () => publicAPI.vehicleClasses(), staleTime: 10 * 60_000, retry: false })
  const lines = items.data?.items ?? []

  const vehicle = r.vehicle_class ? (classes.data?.find(c => c.key === r.vehicle_class)?.name ?? r.vehicle_class.replace(/_/g, ' ')) : null
  const temperature = temperatureText(r.metadata?.temp_mode, r.temp_min_c, r.temp_max_c)
  const handling = specialHandlingLabels(r.special_handling)
  const loadType = r.load_type === 'ftl' ? 'Full truck load (FTL)' : r.load_type === 'ptl' ? 'Part truck load (PTL)' : null

  return (
    <section className="space-y-6" aria-label="Posted load details">
      <div className="space-y-2">
        <Heading>Load</Heading>
        <DetailList items={[
          { label: 'Load number', value: <span className="font-mono font-medium" data-testid="posted-load-number">{r.load_number}</span> },
          { label: 'Priority', value: r.priority ? priorityLabel(r.priority) : 'Medium' },
          { label: 'Recommended freight', value: r.price_min_inr != null && r.price_max_inr != null && r.price_min_inr !== '' ? <span className="tabular">{formatRupees(r.price_min_inr)} – {formatRupees(r.price_max_inr)}</span> : 'Not worked out' },
          ...(r.budget_inr != null && r.budget_inr !== '' ? [{ label: 'Budget (older load)', value: <span className="tabular">{formatRupees(r.budget_inr)}</span> }] : []),
          { label: 'Total weight', value: <span className="tabular">{formatKg(r.total_weight_kg)}</span> },
          { label: 'Total declared value', value: <span className="tabular">{formatRupees(r.total_declared_value)}</span> },
          { label: 'e-Way Bill', value: r.eway_required ? 'Needed. The carrier or company adds it after assignment.' : 'Not needed' },
          { label: 'Hazardous goods', value: r.hazmat_mixed ? 'Yes. Only hazmat-certified vehicles can carry this load.' : 'No' },
        ]} />
      </div>

      <div className="space-y-2">
        <Heading>Products</Heading>
        {items.isLoading && <Skeleton className="h-16 w-full" />}
        {items.isError && <Alert tone="info">The product lines are not available to you yet.</Alert>}
        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]" aria-label="Products">
              <thead><tr className="border-b border-border">
                <th className={th}>Product</th><th className={th}>HSN</th>
                <th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>Quantity</th>
                <th className={`${th} text-right`}>Weight</th><th className={`${th} text-right`}>Value</th>
              </tr></thead>
              <tbody>
                {lines.map((i, n) => (
                  <tr key={i.id ?? n} className="border-b border-border last:border-0">
                    <td className={td}>{i.product_name}</td>
                    <td className={`${td} font-mono`}>{i.hsn_code}</td>
                    <td className={`${td} text-right tabular`}>{i.gst_rate != null ? `${Number(i.gst_rate)}%` : '—'}</td>
                    <td className={`${td} text-right tabular`}>{i.quantity != null ? `${Number(i.quantity).toLocaleString('en-IN')}${i.unit ? ` ${i.unit}` : ''}` : '—'}</td>
                    <td className={`${td} text-right tabular`}>{formatKg(i.weight_kg)}</td>
                    <td className={`${td} text-right tabular`}>{formatRupees(i.declared_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {lines.length > 0 && <GstSummary tax={taxFromItems(lines, r.tax_basis ?? null)} hasValue={Number(r.total_declared_value ?? 0) > 0} />}

      <div className="space-y-2">
        <Heading>Pickup</Heading>
        <DetailList items={[
          { label: 'Address', value: place(r.pickup_address ?? null, r.pickup_city ?? null, r.pickup_pincode ?? null) },
          { label: 'Date and slot', value: [r.pickup_date ? formatDate(r.pickup_date) : null, r.pickup_slot ? SLOT[r.pickup_slot] : null].filter(Boolean).join(', ') || null },
          { label: 'Contact', value: contact(r.pickup_contact_name ?? null, r.pickup_contact_phone ?? null) },
          ...(r.loading_dock ? [{ label: 'Loading dock', value: 'Available' }] : []),
          ...(r.access_restrictions ? [{ label: 'Access restrictions', value: r.access_restrictions }] : []),
        ]} />
      </div>

      <div className="space-y-2">
        <Heading>Delivery</Heading>
        <DetailList items={[
          { label: 'Address', value: place(r.delivery_address ?? null, r.delivery_city ?? null, r.delivery_pincode ?? null) },
          ...(r.delivery_date ? [{ label: 'Preferred date', value: formatDate(r.delivery_date) }] : []),
          { label: 'Contact', value: contact(r.delivery_contact_name ?? null, r.delivery_contact_phone ?? null) },
        ]} />
      </div>

      <div className="space-y-2">
        <Heading>Transport</Heading>
        <DetailList items={[
          { label: 'Load type', value: loadType },
          { label: 'Vehicle', value: vehicle },
          { label: 'Capacity', value: tonnes(r.capacity_t ?? null) },
          ...(temperature ? [{ label: 'Temperature', value: temperature }] : []),
          ...(handling.length > 0 ? [{ label: 'Special handling', value: handling.join(', ') }] : []),
          ...(r.loading_help ? [{ label: 'Loading help', value: 'Needed' }] : []),
          ...(r.unloading_help ? [{ label: 'Unloading help', value: 'Needed' }] : []),
        ]} />
      </div>
    </section>
  )
}
