import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Page, PageHeader, TabPanel, Tabs, useTabParam, type TabItem } from '@/components/ui'
import ExceptionsTab from '@/components/cargo/ExceptionsTab'
import TransfersTab from '@/components/cargo/TransfersTab'
import HubsTab from '@/components/cargo/HubsTab'
import RaiseExceptionModal from '@/components/cargo/RaiseExceptionModal'

const TAB_IDS = ['exceptions', 'transfers', 'hubs'] as const
type TabId = (typeof TAB_IDS)[number]

/**
 * Problems: cases, transfers between vehicles and hub stock. Claims live in Money, one place for the
 * table; the old /cargo?tab=claims links (with ?open=) still land on it.
 */
export default function CargoPage() {
  const { search } = useLocation()
  if (new URLSearchParams(search).get('tab') === 'claims') return <Navigate to={`/money${search}`} replace />
  return <ProblemsPage />
}

function ProblemsPage() {
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'exceptions')
  const [raising, setRaising] = useState(false)

  const tabs: TabItem<TabId>[] = [
    { id: 'exceptions', label: 'Problems' },
    { id: 'transfers', label: 'Transfers' },
    { id: 'hubs', label: 'Hubs' },
  ]

  return (
    <Page>
      <PageHeader
        title="Problems"
        description="Where goods are, who holds them, and every problem as a case with an owner and a deadline."
        actions={<Button icon={<Plus size={16} />} onClick={() => setRaising(true)}>Raise a problem</Button>}
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Problems sections" />
      </PageHeader>
      <TabPanel id={tab}>
        {tab === 'exceptions' && <ExceptionsTab />}
        {tab === 'transfers' && <TransfersTab />}
        {tab === 'hubs' && <HubsTab />}
      </TabPanel>
      {raising && <RaiseExceptionModal open onClose={() => setRaising(false)} />}
    </Page>
  )
}
