import { useState } from 'react'
import { Button, Modal } from '@/components/ui'
import type { FreightEstimate } from '@/types/load'
import { inr, kgText } from './logic'

const number = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const rate = (value: number) => `₹${number(value)}`

export default function PriceRecommendationModal({ estimate }: { estimate: FreightEstimate | null }) {
  const [open, setOpen] = useState(false)
  const basis = estimate?.basis
  if (!basis || !estimate) return null
  const distance = number(estimate.distance_km)
  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>View price recommendation</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Price recommendation" size="lg"
      description="Base freight for your selected truck and trip."
      footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
      <div className="space-y-5 text-sm text-text">
        <div className="rounded-lg bg-surface-subtle p-4">
          <p className="text-xs text-muted">Recommended range</p>
          <p className="text-2xl font-semibold tabular">{inr(estimate.low)} – {inr(estimate.high)}</p>
          {estimate.suggested !== undefined && <p className="mt-1">Suggested midpoint: <strong>{inr(estimate.suggested)}</strong></p>}
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-muted">Selected truck</dt><dd>{basis.vehicle_name}</dd></div>
          <div><dt className="text-muted">Rate band used</dt><dd>{basis.truck_type}</dd></div>
          <div><dt className="text-muted">Goods weight</dt><dd>{kgText(basis.weight_kg)}</dd></div>
          <div><dt className="text-muted">Truck capacity</dt><dd>{number(basis.vehicle_capacity_t)} tonnes</dd></div>
          <div><dt className="text-muted">Trip distance</dt><dd>{distance} km ({basis.distance_is_estimate ? 'estimated' : 'road distance'})</dd></div>
          <div><dt className="text-muted">Price per km</dt><dd>{rate(basis.min_per_km)} – {rate(basis.max_per_km)}</dd></div>
        </dl>
        <div className="space-y-1 border-y border-border py-3 tabular">
          <p>Low: {distance} km × {rate(basis.min_per_km)} = {inr(estimate.low)}</p>
          {estimate.suggested !== undefined && <p>Midpoint: {distance} km × {rate(basis.midpoint_per_km)} = {inr(estimate.suggested)}</p>}
          <p>High: {distance} km × {rate(basis.max_per_km)} = {inr(estimate.high)}</p>
          <p className="text-xs text-muted">Prices are rounded to whole rupees.</p>
        </div>
        {basis.distance_is_estimate && <p className="text-muted">Road directions were unavailable. Distance is estimated from the pickup and delivery locations.</p>}
        {basis.load_type === 'ptl' && <p className="text-muted">This is a whole-vehicle reference for a part load. The logistic company confirms how sharing the truck affects your final price.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left" aria-label="Reference truck rates">
            <thead><tr className="border-b border-border"><th className="py-2 pr-3">Truck type</th><th className="py-2 pr-3">Payload / size</th><th className="py-2">Per km</th></tr></thead>
            <tbody>{basis.rates.map(row => <tr key={row.key} className={row.key === basis.rate_key ? 'bg-surface-subtle font-semibold' : ''}>
              <td className="py-2 pr-3">{row.name}{row.key === basis.rate_key ? ' (used)' : ''}</td>
              <td className="py-2 pr-3">{row.payload}</td><td className="whitespace-nowrap py-2">{rate(row.min_per_km)} – {rate(row.max_per_km)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted">The band follows the selected truck's capacity. Container feet describe size; payload capacity comes from the selected truck.</p>
        <p className="text-muted">Base freight only. Freight GST, tolls, loading, unloading and other extras are separate. {estimate.label}.</p>
      </div>
    </Modal>
  </>
}
