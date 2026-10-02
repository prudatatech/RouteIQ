import { useQuery } from '@tanstack/react-query'
import { publicAPI, type PublicCompany } from '@/services/api'
import { Checkbox, Skeleton } from '@/components/ui'
import { MAX_CHOSEN_COMPANIES } from '@/types/routing'

/** The companies serving the pickup or the delivery city, each once. */
async function companiesForLane(pickupCity: string, deliveryCity: string): Promise<PublicCompany[]> {
  const cities = [...new Set([pickupCity.trim(), deliveryCity.trim()].filter(Boolean))]
  const lists = await Promise.all(cities.length > 0 ? cities.map(city => publicAPI.companies({ city })) : [publicAPI.companies({})])
  const byId = new Map<string, PublicCompany>()
  for (const c of lists.flat()) if (!byId.has(c.id)) byId.set(c.id, c)
  return [...byId.values()].sort((a, b) => b.trips_completed - a.trips_completed || a.name.localeCompare(b.name))
}

/** Pick up to 10 companies to quote on a load. The list comes from the public companies call, so guests can pick too. */
export default function CompanyPicker({ pickupCity, deliveryCity, selected, onChange }: {
  pickupCity: string
  deliveryCity: string
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const companies = useQuery({
    queryKey: ['public', 'companies', 'lane', pickupCity, deliveryCity],
    queryFn: () => companiesForLane(pickupCity, deliveryCity),
    staleTime: 60_000,
  })
  const full = selected.length >= MAX_CHOSEN_COMPANIES
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter(x => x !== id))

  if (companies.isLoading) return <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div>
  if (companies.isError) return <p className="text-sm text-danger" role="alert">We could not load the companies. Check your connection and try again.</p>
  const list = companies.data ?? []
  if (list.length === 0) {
    return <p className="text-sm text-muted">No companies serve these cities yet. Choose "Open to all companies" and we will tell the ones that can.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted" aria-live="polite">
        {selected.length} of {MAX_CHOSEN_COMPANIES} chosen{full ? '. That is the most you can choose.' : ''}
      </p>
      <ul className="max-h-72 space-y-2 overflow-y-auto">
        {list.map(c => {
          const checked = selected.includes(c.id)
          return (
            <li key={c.id} className="rounded-control border border-border p-3">
              <Checkbox
                label={<span className="font-medium">{c.name}</span>}
                description={`${c.city ?? 'City not given'} · ${c.trips_completed.toLocaleString('en-IN')} ${c.trips_completed === 1 ? 'trip' : 'trips'} completed`}
                checked={checked}
                disabled={!checked && full}
                onChange={e => toggle(c.id, e.target.checked)}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
