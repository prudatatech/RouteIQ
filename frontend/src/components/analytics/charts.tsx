import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipProps,
} from 'recharts'
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { chartColors as c, formatCompact, formatNumber, seriesPalette } from './format'

/*
 * One chart style for analytics and backhaul: theme colours, 12px axis labels,
 * Indian number format, a tooltip on every mark, and loading, empty and error
 * states inside the card.
 */

const axisTick = { fill: c.textMuted, fontSize: 12 }

export interface Series {
  key: string
  label: string
}

/** Card that holds a chart and shows loading, error and empty states in its place. */
export function ChartCard({ title, description, loading, error, onRetry, empty, emptyTitle, emptyDescription, height = 'h-64', children, className }: {
  title: ReactNode
  description?: ReactNode
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  /** True when there is nothing to plot. */
  empty?: boolean
  emptyTitle?: ReactNode
  emptyDescription?: ReactNode
  /** Height class of the plot area. */
  height?: string
  children: ReactNode
  className?: string
}) {
  let body: ReactNode = children
  if (error) {
    body = <ErrorState compact title="We could not load this chart" description="Check your connection and try again." onRetry={onRetry} />
  } else if (loading) {
    body = <Skeleton className="h-full w-full" />
  } else if (empty) {
    body = <EmptyState compact title={emptyTitle ?? 'Nothing to show yet'} description={emptyDescription} />
  }

  return (
    <Card className={clsx('flex min-w-0 flex-col', className)}>
      <CardHeader title={title} description={description} />
      <div className={clsx('px-2 py-4 sm:px-4', !error && !empty && height)}>{body}</div>
    </Card>
  )
}

function ChartTooltip({ active, payload, label, formatValue, formatLabel }: TooltipProps<number, string> & {
  formatValue: (n: number) => string
  formatLabel?: (label: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-control border border-border bg-surface px-3 py-2 text-sm shadow-raised">
      <p className="mb-1 font-medium text-text">{formatLabel ? formatLabel(String(label)) : label}</p>
      {payload.map(p => {
        const dot = seriesPalette.find(s => s.color === p.color)?.dotClass ?? 'bg-neutral'
        return (
          <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted">
            <span aria-hidden="true" className={clsx('inline-block h-2 w-2 rounded-full', dot)} />
            {p.name}: <span className="font-medium tabular text-text">{typeof p.value === 'number' ? formatValue(p.value) : '—'}</span>
          </p>
        )
      })}
    </div>
  )
}

const legendFormatter = (value: string) => <span className="text-sm text-muted">{value}</span>
const defaultFormat = (n: number) => formatNumber(n)
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Bars over categories or days. `horizontal` lays the bars sideways for long names. */
export function SimpleBarChart<T extends object>({ data, categoryKey, series, formatValue = defaultFormat, formatCategory, horizontal, label }: {
  data: T[]
  categoryKey: keyof T & string
  series: Series[]
  formatValue?: (n: number) => string
  formatCategory?: (value: string) => string
  horizontal?: boolean
  /** Accessible summary of what the chart shows. */
  label: string
}) {
  const categoryAxis = {
    dataKey: categoryKey,
    tick: axisTick,
    tickLine: false,
    axisLine: { stroke: c.border },
    tickFormatter: (v: string) => truncate(formatCategory ? formatCategory(v) : String(v), horizontal ? 14 : 24),
  }
  const valueAxis = {
    tick: axisTick,
    tickLine: false,
    axisLine: false,
    allowDecimals: false,
    tickFormatter: formatCompact,
  }
  return (
    <div role="img" aria-label={label} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
          barGap={2}
          barCategoryGap="24%"
        >
          <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={!!horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" {...valueAxis} />
              <YAxis type="category" width={104} {...categoryAxis} />
            </>
          ) : (
            <>
              <XAxis {...categoryAxis} minTickGap={8} />
              <YAxis width={40} {...valueAxis} />
            </>
          )}
          <Tooltip
            cursor={{ fill: c.surfaceSubtle }}
            content={<ChartTooltip formatValue={formatValue} formatLabel={formatCategory} />}
          />
          {series.length > 1 && (
            <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8} formatter={legendFormatter} />
          )}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={seriesPalette[i % seriesPalette.length].color}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** One measure over time. */
export function SimpleLineChart<T extends object>({ data, categoryKey, series, formatValue = defaultFormat, label }: {
  data: T[]
  categoryKey: keyof T & string
  series: Series
  formatValue?: (n: number) => string
  label: string
}) {
  return (
    <div role="img" aria-label={label} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={categoryKey} tick={axisTick} tickLine={false} axisLine={{ stroke: c.border }} minTickGap={24} />
          <YAxis
            width={48}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={formatCompact}
          />
          <Tooltip cursor={{ stroke: c.borderStrong }} content={<ChartTooltip formatValue={formatValue} />} />
          <Line
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={seriesPalette[0].color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
