import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DateRangeControl, Page, PageHeader, presetRange, TabPanel, Tabs, useTabParam, type DateRangeValue, type TabItem,
} from '@/components/ui'
import ToPriceTab from '@/components/money/ToPriceTab'
import { useUnpriced } from '@/components/money/useUnpriced'
import InvoicesTab from '@/components/money/InvoicesTab'
import ExpensesTab from '@/components/money/ExpensesTab'
import ClaimsTab from '@/components/cargo/ClaimsTab'

const TAB_IDS = ['to-price', 'invoices', 'expenses', 'claims', 'driver-pay'] as const
type TabId = typeof TAB_IDS[number]

/** Tabs that read a date range. */
const RANGED: TabId[] = ['to-price', 'invoices', 'expenses']

/** Money: price deliveries, follow invoices, log expenses, settle claims and pay drivers. */
export default function MoneyPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'to-price')
  const [range, setRange] = useState<DateRangeValue>({ preset: '30d', ...presetRange('30d') })
  // Shares its query with the To price tab, so the count on the tab is the list below it
  const unpriced = useUnpriced(range)

  const tabs: TabItem<TabId>[] = [
    { id: 'to-price', label: 'To price', count: unpriced.data?.length },
    { id: 'invoices', label: 'Invoices' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'claims', label: 'Claims' },
    { id: 'driver-pay', label: 'Driver pay' },
  ]

  const onTab = (id: TabId) => {
    // Driver pay has its own page
    if (id === 'driver-pay') navigate('/money/driver-pay')
    else setTab(id)
  }

  return (
    <Page>
      <PageHeader title="Money" description="Price deliveries, follow invoices, and keep track of costs, claims and driver pay. Payments are offline: mark an invoice paid when the money arrives. Profit and loss is in Reports.">
        <div className="flex flex-col gap-3">
          <Tabs tabs={tabs} value={tab} onChange={onTab} label="Money sections" />
          {RANGED.includes(tab) && <DateRangeControl value={range} onChange={setRange} />}
        </div>
      </PageHeader>
      <TabPanel id={tab}>
        {tab === 'to-price' && <ToPriceTab range={range} />}
        {tab === 'invoices' && <InvoicesTab range={range} />}
        {tab === 'expenses' && <ExpensesTab range={range} />}
        {tab === 'claims' && <ClaimsTab />}
      </TabPanel>
    </Page>
  )
}
