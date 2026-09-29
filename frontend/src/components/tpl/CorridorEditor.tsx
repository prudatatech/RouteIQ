import { Trash2, Plus } from 'lucide-react'
import { Input, Select } from '@/components/ui'
import { Button, IconButton } from '@/components/ui'
import { CORRIDOR_PRIORITY_OPTIONS, emptyCorridorRow, type CorridorFormRow } from './constants'

/**
 * The corridor & rate declaration list used by both the 3PL onboarding form and
 * the partner dashboard's settings tab. Add/edit/remove operational corridors.
 */
export function CorridorEditor({ corridors, onChange }: {
  corridors: CorridorFormRow[]
  onChange: (rows: CorridorFormRow[]) => void
}) {
  const update = (id: number, patch: Partial<CorridorFormRow>) => {
    onChange(corridors.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }
  const remove = (id: number) => onChange(corridors.filter(c => c.id !== id))
  const add = () => onChange([...corridors, emptyCorridorRow()])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Corridors and rates</h3>
        <Button type="button" variant="secondary" size="sm" icon={<Plus size={14} />} onClick={add}>
          Add corridor
        </Button>
      </div>
      <div className="space-y-3">
        {corridors.map(c => (
          <div key={c.id} className="relative rounded-control border border-border bg-surface-subtle p-4">
            {corridors.length > 1 && (
              <IconButton
                label="Remove corridor"
                icon={<Trash2 size={14} />}
                variant="ghost"
                size="sm"
                className="absolute right-2 top-2"
                onClick={() => remove(c.id)}
              />
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label="Corridor"
                placeholder="e.g. DEL-BOM"
                value={c.name}
                onChange={e => update(c.id, { name: e.target.value.toUpperCase() })}
              />
              <Input
                label="Vehicle types"
                placeholder="e.g. 32ft SXL, 20ft"
                hint="Comma-separated"
                value={c.vehicles}
                onChange={e => update(c.id, { vehicles: e.target.value })}
              />
              <Input
                label="Proposed rate"
                placeholder="e.g. Base + 12%"
                value={c.rate}
                onChange={e => update(c.id, { rate: e.target.value })}
              />
              <Select
                label="Priority"
                options={CORRIDOR_PRIORITY_OPTIONS}
                value={c.priority}
                onChange={e => update(c.id, { priority: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
