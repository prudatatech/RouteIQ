import { useState } from 'react'
import {
  DateRangeControl, Page, PageHeader, presetRange, TabPanel, Tabs, useTabParam, type DateRangeValue, type TabItem,
} from '@/components/ui'
import InvoicesPanel from '@/components/finance/InvoicesPanel'
import ExpensesPanel from '@/components/finance/ExpensesPanel'

const TAB_IDS = ['invoices', 'expenses'] as const
type TabId = typeof TAB_IDS[number]

const TABS: TabItem<TabId>[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'expenses', label: 'Expenses' },
]

export default function FinancePage() {
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'invoices')
  const [range, setRange] = useState<DateRangeValue>({ preset: '30d', ...presetRange('30d') })

  return (
    <Page>
      <PageHeader title="Finance" description="Invoices for delivered loads and the costs of running the fleet. Profit and loss is in Analytics.">
        <div className="flex flex-col gap-3">
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Finance sections" />
          <DateRangeControl value={range} onChange={setRange} />
        </div>
      </PageHeader>
      <TabPanel id={tab}>
        {tab === 'invoices' && <InvoicesPanel range={range} />}
        {tab === 'expenses' && <ExpensesPanel range={range} />}
      </TabPanel>
    </Page>
  )
}
