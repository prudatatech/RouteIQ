import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsAPI } from '@/services/api'
import {
  Button, DataTable, DateRangeControl, DetailList, Drawer, Page, PageHeader, presetRange, SearchInput, Select,
  StatusPill, humanize, type Column, type DateRangeValue,
} from '@/components/ui'
import { formatDateTime, formatRelative } from '@/utils/display'

/** Entries fetched per page from the server. */
const PAGE_SIZE = 100

interface AuditEntry {
  id: string
  agent: string | null
  action: string | null
  result: string | null
  status: string | null
  timestamp: string
}

const ALL = ''

/** Distinct values of a column as select options. */
const optionsFor = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort().map(v => ({ value: v, label: humanize(v) }))

export default function AuditLogPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(ALL)
  const [agent, setAgent] = useState(ALL)
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const [range, setRange] = useState<DateRangeValue>({ preset: '30d', ...presetRange('30d') })
  const [loadedPages, setLoadedPages] = useState(1)

  const limit = PAGE_SIZE * loadedPages

  const logs = useQuery({
    queryKey: ['audit-logs', range.from, range.to, limit],
    queryFn: () => analyticsAPI.auditLogs({ limit, offset: 0, from: range.from, to: range.to }) as Promise<{ items: AuditEntry[]; hasMore: boolean }>,
  })

  const changeRange = (next: DateRangeValue) => { setRange(next); setLoadedPages(1) }

  const all = useMemo(() => logs.data?.items ?? [], [logs.data])
  const statusOptions = useMemo(() => optionsFor(all.map(l => l.status)), [all])
  const agentOptions = useMemo(() => optionsFor(all.map(l => l.agent)), [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(l => (!status || l.status === status) && (!agent || l.agent === agent)
      && (!q || [l.action, l.result, l.agent].some(v => (v ?? '').toLowerCase().includes(q))))
  }, [all, search, status, agent])

  const filtered = !!(search || status || agent)
  const clear = () => { setSearch(''); setStatus(ALL); setAgent(ALL) }

  const columns: Column<AuditEntry>[] = [
    {
      key: 'time', header: 'When', width: 'w-44',
      sortValue: l => new Date(l.timestamp).getTime(),
      cell: l => <span title={formatDateTime(l.timestamp)}>{formatRelative(l.timestamp)}</span>,
    },
    {
      key: 'agent', header: 'Source', hideBelow: 'md',
      sortValue: l => l.agent ?? '',
      cell: l => (l.agent ? humanize(l.agent) : '—'),
    },
    {
      key: 'action', header: 'What happened',
      cell: l => <span className="line-clamp-2">{l.action || '—'}</span>,
    },
    {
      key: 'status', header: 'Result',
      sortValue: l => l.status ?? '',
      cell: l => <StatusPill status={l.status} />,
    },
  ]

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="Actions the system has taken automatically, newest first."
      >
        <div className="flex flex-col gap-3">
          <DateRangeControl value={range} onChange={changeRange} />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <SearchInput value={search} onChange={setSearch} label="Search the audit log" placeholder="Search entries" className="sm:w-72" />
            <Select
              label="Result"
              hideLabel
              className="sm:w-48"
              value={status}
              onChange={e => setStatus(e.target.value)}
              options={[{ value: ALL, label: 'All results' }, ...statusOptions]}
              disabled={statusOptions.length === 0}
            />
            <Select
              label="Source"
              hideLabel
              className="sm:w-56"
              value={agent}
              onChange={e => setAgent(e.target.value)}
              options={[{ value: ALL, label: 'All sources' }, ...agentOptions]}
              disabled={agentOptions.length === 0}
            />
            {filtered && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
          </div>
        </div>
      </PageHeader>

      <DataTable
        caption="Audit log"
        columns={columns}
        rows={rows}
        rowKey={l => l.id}
        loading={logs.isLoading}
        error={logs.error ? 'We could not load the audit log. Check your connection and try again.' : undefined}
        onRetry={() => logs.refetch()}
        onRowClick={setSelected}
        selectedKey={selected?.id}
        initialSort={{ key: 'time', direction: 'desc' }}
        pageSize={25}
        empty={filtered
          ? { title: 'No entries match these filters', action: <Button variant="secondary" onClick={clear}>Clear filters</Button> }
          : { title: 'No audit entries in this range', description: 'Automated actions are recorded here as they happen.' }}
      />

      {logs.data?.hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={logs.isFetching} onClick={() => setLoadedPages(n => n + 1)}>Load more</Button>
        </div>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Audit entry" description={selected ? formatDateTime(selected.timestamp) : undefined}>
        {selected && (
          <DetailList
            columns={1}
            items={[
              { label: 'Result', value: <StatusPill status={selected.status} /> },
              { label: 'Source', value: selected.agent ? humanize(selected.agent) : '—' },
              { label: 'Action taken', value: selected.action || '—' },
              { label: 'Outcome', value: <span className="whitespace-pre-wrap">{selected.result || '—'}</span> },
            ]}
          />
        )}
      </Drawer>
    </Page>
  )
}
