import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Page, PageHeader, TabPanel, Tabs, useTabParam, type TabItem } from '@/components/ui'
import ExceptionsTab from '@/components/cargo/ExceptionsTab'
import TransfersTab from '@/components/cargo/TransfersTab'
import HubsTab from '@/components/cargo/HubsTab'
import ClaimsTab from '@/components/cargo/ClaimsTab'
import RaiseExceptionModal from '@/components/cargo/RaiseExceptionModal'

const TAB_IDS = ['exceptions', 'transfers', 'hubs', 'claims'] as const
type TabId = (typeof TAB_IDS)[number]

/** The cargo control tower: exception cases, transfers between vehicles, hub stock and claims. */
export default function CargoPage() {
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'exceptions')
  const [raising, setRaising] = useState(false)

  const tabs: TabItem<TabId>[] = [
    { id: 'exceptions', label: 'Exceptions' },
    { id: 'transfers', label: 'Transfers' },
    { id: 'hubs', label: 'Hubs' },
    { id: 'claims', label: 'Claims' },
  ]

  return (
    <Page>
      <PageHeader
        title="Cargo"
        description="Where goods are, who holds them, and every problem as a case with an owner and a deadline."
        actions={<Button icon={<Plus size={16} />} onClick={() => setRaising(true)}>Raise exception</Button>}
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Cargo sections" />
      </PageHeader>
      <TabPanel id={tab}>
        {tab === 'exceptions' && <ExceptionsTab />}
        {tab === 'transfers' && <TransfersTab />}
        {tab === 'hubs' && <HubsTab />}
        {tab === 'claims' && <ClaimsTab />}
      </TabPanel>
      {raising && <RaiseExceptionModal open onClose={() => setRaising(false)} />}
    </Page>
  )
}
