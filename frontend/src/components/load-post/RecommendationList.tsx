import { Alert, Button } from '@/components/ui'
import type { Recommendation, VehicleClass } from '@/types/load'
import { actionLabel } from './logic'

/**
 * The server's suggestions for the field the person is on. A suggestion with a fix shows a
 * one-click button; the fix changes the draft and the suggestions are fetched again.
 */
export default function RecommendationList({ recommendations, onApply, vehicles = [], className }: {
  recommendations: Recommendation[]
  onApply: (action: NonNullable<Recommendation['action']>) => void
  vehicles?: VehicleClass[]
  className?: string
}) {
  if (recommendations.length === 0) return null
  return (
    <div className={className ?? 'space-y-2'} aria-label="Suggestions">
      {recommendations.map(rec => {
        const vehicle = rec.action?.field === 'vehicle_class' ? vehicles.find(v => v.key === rec.action?.value)?.name : undefined
        return (
          <Alert
            key={`${rec.code}-${rec.message}`}
            tone={rec.severity === 'warn' ? 'warning' : 'info'}
            action={rec.action ? (
              <Button variant="secondary" size="sm" onClick={() => onApply(rec.action!)}>{actionLabel(rec.action, vehicle)}</Button>
            ) : undefined}
          >
            {rec.message}
          </Alert>
        )
      })}
    </div>
  )
}
