import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs, TabPanel, useTabParam, type TabItem } from '@/components/ui'
import OpenLoadsTab from './OpenLoadsTab'
import PoolLoadsTab from './PoolLoadsTab'
import MatchReturnLoadTab from './MatchReturnLoadTab'
import ConfirmDeliveryTab from './ConfirmDeliveryTab'
import PriceLoadTab from './PriceLoadTab'
import { useOpenLoads, type DuplicatedManifest } from './data'

export const POOL_VIEWS = ['loads', 'plan', 'match', 'price', 'delivery'] as const
export type PoolView = typeof POOL_VIEWS[number]

/**
 * The tools for loads that are not on a trip yet: the list of open loads, pooling several onto one truck,
 * matching a load to a returning truck, pricing a load, and confirming a delivery.
 * The view is in the URL as `?view=`.
 */
export default function PoolTools() {
  const location = useLocation()
  const navigate = useNavigate()
  // Route details → Duplicate sends the route here.
  const manifest = (location.state as { duplicateManifest?: DuplicatedManifest } | null)?.duplicateManifest ?? null
  const [view, setView] = useTabParam<PoolView>(POOL_VIEWS, manifest ? 'match' : 'loads', 'view')
  const loads = useOpenLoads()

  const dismissManifest = useCallback(() => {
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [navigate, location.pathname, location.search])

  const views: TabItem<PoolView>[] = [
    { id: 'loads', label: 'Open loads', count: loads.data?.length },
    { id: 'plan', label: 'Combine loads' },
    { id: 'match', label: 'Match a return load' },
    { id: 'price', label: 'Price a load' },
    { id: 'delivery', label: 'Confirm delivery' },
  ]

  return (
    <div className="space-y-6">
      <Tabs tabs={views} value={view} onChange={setView} label="Combine loads tools" />
      <TabPanel id={view}>
        {view === 'loads' && <OpenLoadsTab />}
        {view === 'plan' && <PoolLoadsTab />}
        {view === 'match' && <MatchReturnLoadTab manifest={manifest} onDismissManifest={dismissManifest} />}
        {view === 'price' && <PriceLoadTab />}
        {view === 'delivery' && <ConfirmDeliveryTab />}
      </TabPanel>
    </div>
  )
}
