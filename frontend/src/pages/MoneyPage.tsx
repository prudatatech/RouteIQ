import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { financeAPI } from '@/services/api'
import type { InvoiceSummary } from '@/utils/finance'
import { formatRupees } from '@/utils/display'
import {
  DateRangeControl, Page, PageHeader, presetRange, TabPanel, Tabs, useOpenOnWork, useTabParam, type DateRangeValue, type TabItem,
} from '@/components/ui'
import ToPriceTab from '@/components/money/ToPriceTab'
import { useUnpriced } from '@/components/money/useUnpriced'
import InvoicesTab from '@/components/money/InvoicesTab'
import ExpensesTab from '@/components/money/ExpensesTab'
import ClaimsTab from '@/components/cargo/ClaimsTab'
import DriverPayTab from '@/components/money/DriverPayTab'

const TAB_IDS = ['to-price', 'invoices', 'expenses', 'claims', 'driver-pay'] as const
type TabId = typeof TAB_IDS[number]

/** Tabs that read a date range. */
const RANGED: TabId[] = ['to-price', 'invoices', 'expenses']

/** Money: price deliveries, follow invoices, log expenses, settle claims and pay drivers. */
export default function MoneyPage() {
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'to-price')
  const [range, setRange] = useState<DateRangeValue>({ preset: '30d', ...presetRange('30d') })
  // Shares its query with the To price tab, so the count on the tab is the list below it
  const unpriced = useUnpriced(range)
  // The same query Invoices uses for its totals, so the tab count is what the tab shows
  const invoiceSummary = useQuery<InvoiceSummary>({ queryKey: ['finance', 'invoice-summary'], queryFn: () => financeAPI.invoiceSummary() })
  useOpenOnWork(['to-price', 'invoices'] as const, {
    'to-price': unpriced.isLoading ? undefined : unpriced.data?.length ?? 0,
    invoices: invoiceSummary.isLoading ? undefined : invoiceSummary.data?.outstanding_count ?? 0,
  }, tab, setTab)

  const tabs: TabItem<TabId>[] = [
    { id: 'to-price', label: 'To price', count: unpriced.data?.length },
    { id: 'invoices', label: 'Invoices' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'claims', label: 'Claims' },
    { id: 'driver-pay', label: 'Driver pay' },
  ]

  const inv = invoiceSummary.data

  return (
    <Page>
      <PageHeader title="Money" description="Price deliveries, follow invoices, and keep track of costs, claims and driver pay.">
        <div className="flex flex-col gap-3">
          <Tabs tabs={tabs} value={tab} onChange={setTab} label="Money sections" />
          {RANGED.includes(tab) && <DateRangeControl value={range} onChange={setRange} />}
        </div>
      </PageHeader>

      {/* Financial Pulse KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
          <span className="text-xs font-semibold text-warning uppercase tracking-wider">Outstanding Invoices</span>
          <p className="mt-1 text-2xl font-bold tabular text-warning">
            {invoiceSummary.isLoading ? '–' : formatRupees(inv?.outstanding ?? 0)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{inv?.outstanding_count ?? 0} invoices awaiting payment</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
          <span className="text-xs font-semibold text-danger uppercase tracking-wider">Overdue Invoices</span>
          <p className="mt-1 text-2xl font-bold tabular text-danger">
            {invoiceSummary.isLoading ? '–' : formatRupees(inv?.overdue ?? 0)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{inv?.overdue_count ?? 0} past due</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
          <span className="text-xs font-semibold text-success uppercase tracking-wider">Settled This Month</span>
          <p className="mt-1 text-2xl font-bold tabular text-success">
            {invoiceSummary.isLoading ? '–' : formatRupees(inv?.collected_this_month ?? 0)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{inv?.collected_count ?? 0} collected</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
          <span className="text-xs font-semibold text-brand uppercase tracking-wider">Pending Pricing</span>
          <p className="mt-1 text-2xl font-bold tabular text-brand">
            {unpriced.isLoading ? '–' : (unpriced.data?.length ?? 0)}
          </p>
          <p className="mt-0.5 text-xs text-muted">Ready to rate and bill</p>
        </div>
      </div>

      <TabPanel id={tab}>
        {tab === 'to-price' && <ToPriceTab range={range} />}
        {tab === 'invoices' && <InvoicesTab range={range} />}
        {tab === 'expenses' && <ExpensesTab range={range} />}
        {tab === 'claims' && <ClaimsTab />}
        {tab === 'driver-pay' && <DriverPayTab />}
      </TabPanel>
    </Page>
  )
}
