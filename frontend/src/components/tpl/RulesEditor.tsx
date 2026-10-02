import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Card, CardHeader, Checkbox, ErrorState, Input, Skeleton } from '@/components/ui'
import { networkAPI, publicAPI } from '@/services/api'
import { errorMessage } from '@/utils/display'
import { rulesPayload } from './networkHelpers'

export interface RuleCorridor { id: string; corridor_name: string }

/**
 * The rules this company sets for offers to one partner: which vehicle classes and lanes to offer them, the lowest
 * rate per km they may quote, and whether their vehicles need GPS and insurance. Empty lists mean no limit.
 */
export default function RulesEditor({ tplId, corridors }: { tplId: string; corridors: RuleCorridor[] }) {
  const queryClient = useQueryClient()
  const rules = useQuery({ queryKey: ['network-rules', tplId], queryFn: () => networkAPI.rules(tplId), retry: false })
  const classes = useQuery({ queryKey: ['vehicle-classes'], queryFn: publicAPI.vehicleClasses, staleTime: 3_600_000 })

  const [picked, setPicked] = useState<string[]>([])
  const [corridorIds, setCorridorIds] = useState<string[]>([])
  const [minRate, setMinRate] = useState('')
  const [gps, setGps] = useState(false)
  const [insurance, setInsurance] = useState(false)

  useEffect(() => {
    const r = rules.data
    if (!r) return
    setPicked(r.vehicle_classes ?? [])
    setCorridorIds(r.corridor_ids ?? [])
    setMinRate(r.min_rate_per_km != null ? String(r.min_rate_per_km) : '')
    setGps(!!r.gps_required)
    setInsurance(!!r.insurance_required)
  }, [rules.data])

  const rate = Number(minRate)
  const rateError = minRate.trim() !== '' && (!Number.isFinite(rate) || rate < 0) ? 'Enter a rate of 0 or more' : undefined
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])

  const save = useMutation({
    mutationFn: () => networkAPI.saveRules(tplId, rulesPayload({ classes: picked, corridorIds, minRate, gps, insurance })),
    onSuccess: () => { toast.success('Rules saved. They apply to the next offers.'); queryClient.invalidateQueries({ queryKey: ['network-rules', tplId] }) },
    onError: err => toast.error(errorMessage(err, 'We could not save the rules. Try again.')),
  })

  return (
    <Card padded className="space-y-5">
      <CardHeader title="Rules for offers" description="Only loads that fit these rules are offered to this partner. Leave a list empty for no limit." className="-mx-4 -mt-4 sm:-mx-6" />
      {rules.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rules.error ? (
        <ErrorState compact description="We could not load the rules." onRetry={() => rules.refetch()} />
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-text">Vehicle classes</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(classes.data ?? []).map(c => (
                <Checkbox key={c.key} label={c.name} checked={picked.includes(c.key)} onChange={() => toggle(picked, setPicked, c.key)} />
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-text">Lanes</legend>
            {corridors.length === 0 ? (
              <p className="text-sm text-muted">This partner has no lanes on record.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {corridors.map(c => (
                  <Checkbox key={c.id} label={c.corridor_name} checked={corridorIds.includes(c.id)} onChange={() => toggle(corridorIds, setCorridorIds, c.id)} />
                ))}
              </div>
            )}
          </fieldset>
          <Input
            label="Lowest rate per km (₹)"
            type="number"
            min={0}
            className="max-w-xs"
            hint="Offers priced under this are not sent. Leave blank for no limit."
            value={minRate}
            onChange={e => setMinRate(e.target.value)}
            error={rateError}
          />
          <div className="space-y-2">
            <Checkbox label="Vehicles must have GPS" checked={gps} onChange={e => setGps(e.target.checked)} />
            <Checkbox label="Vehicles must have valid insurance" checked={insurance} onChange={e => setInsurance(e.target.checked)} />
          </div>
          <Button loading={save.isPending} disabled={!!rateError} onClick={() => save.mutate()}>Save rules</Button>
        </>
      )}
    </Card>
  )
}
