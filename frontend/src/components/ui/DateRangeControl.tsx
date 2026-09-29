import clsx from 'clsx'
import { Input } from './Field'
import { presetRange, todayIST, type DateRangePreset, type DateRangeValue } from './dateRange'

const PRESET_LABEL: Record<Exclude<DateRangePreset, 'custom'>, string> = { today: 'Today', '7d': '7 days', '30d': '30 days' }

/**
 * Date-range picker shared by every page that filters by date: Today, 7 days,
 * 30 days, or a custom range. Feeds `from`/`to` (YYYY-MM-DD, IST calendar
 * days) straight into the matching backend query params.
 */
export function DateRangeControl({ value, onChange, className }: {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  className?: string
}) {
  const setPreset = (preset: Exclude<DateRangePreset, 'custom'>) => onChange({ preset, ...presetRange(preset) })

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      <div role="group" aria-label="Date range" className="inline-flex items-center gap-0.5 rounded-control border border-border p-0.5">
        {(Object.keys(PRESET_LABEL) as Exclude<DateRangePreset, 'custom'>[]).map(p => (
          <button
            key={p}
            type="button"
            aria-pressed={value.preset === p}
            onClick={() => setPreset(p)}
            className={clsx(
              'rounded-control px-3 py-1.5 text-sm font-medium transition-colors',
              value.preset === p ? 'bg-brand-fill text-on-brand' : 'text-text hover:bg-surface-subtle',
            )}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value.preset === 'custom'}
          onClick={() => onChange({ preset: 'custom', from: value.from, to: value.to })}
          className={clsx(
            'rounded-control px-3 py-1.5 text-sm font-medium transition-colors',
            value.preset === 'custom' ? 'bg-brand-fill text-on-brand' : 'text-text hover:bg-surface-subtle',
          )}
        >
          Custom
        </button>
      </div>

      {value.preset === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            label="From date"
            hideLabel
            value={value.from}
            max={value.to}
            onChange={e => onChange({ ...value, from: e.target.value })}
            className="w-40"
          />
          <span className="text-sm text-muted">to</span>
          <Input
            type="date"
            label="To date"
            hideLabel
            value={value.to}
            min={value.from}
            max={todayIST()}
            onChange={e => onChange({ ...value, to: e.target.value })}
            className="w-40"
          />
        </div>
      )}
    </div>
  )
}
