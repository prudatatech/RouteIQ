import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageHeader, TabPanel, Tabs, useOpenOnWork, useTabParam } from '@/components/ui'
import { routesAPI, shipmentsAPI } from '@/services/api'
import { openChannel, supabase } from '@/services/supabase'
import NeedsVehicleTab from '@/components/dispatch/NeedsVehicleTab'
import TripsToSendTab, { type TripRow } from '@/components/dispatch/TripsToSendTab'
import { needsVehicle, tripsMissingEwayBill } from '@/components/dispatch/logic'
import type { ShipmentRow } from '@/components/shipments/types'
import OptimizePage from '@/pages/OptimizePage'
import RoutePlannerPage from '@/pages/RoutePlannerPage'

/** Today and the menu link to `?tab=needs-vehicle` and `?tab=to-send`. */
const TAB_IDS = ['needs-vehicle', 'to-send', 'plan', 'optimize'] as const
type TabId = (typeof TAB_IDS)[number]

/** Enough to hold every open shipment; the list is newest first. */
const LIST_LIMIT = 500

/**
 * One place to get shipments onto trucks: assign a vehicle to what has none, send planned trips to
 * their drivers, plan a trip by hand, or let the optimizer plan many at once.
 */
export default function DispatchPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'needs-vehicle')
  // "Optimize these" hands the chosen shipments to the Optimize tab; the key makes it start from them again
  const [optimize, setOptimize] = useState<{ ids: string[]; key: number } | null>(null)

  const shipments = useQuery<ShipmentRow[]>({
    queryKey: ['shipments', 'dispatch'],
    queryFn: () => shipmentsAPI.list({ limit: LIST_LIMIT }) as Promise<ShipmentRow[]>,
  })
  const trips = useQuery<TripRow[]>({
    queryKey: ['routes', 'pending'],
    queryFn: () => routesAPI.list({ status: 'pending', limit: 200 }) as Promise<TripRow[]>,
    refetchInterval: 20_000,
  })

  // Keep both lists current when shipments or trips change anywhere
  useEffect(() => {
    const channel = openChannel('public:dispatch_workspace')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, () => {
        queryClient.invalidateQueries({ queryKey: ['shipments'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, () => {
        queryClient.invalidateQueries({ queryKey: ['routes'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  const needing = useMemo(() => (shipments.data ?? []).filter(needsVehicle), [shipments.data])
  // A vendor load is its own trip and is started by its driver, so it is not sent from here
  const toSend = useMemo(() => (trips.data ?? []).filter(t => t.status === 'pending' && !t.is_manifest), [trips.data])

  useOpenOnWork(['needs-vehicle', 'to-send'] as const, {
    'needs-vehicle': shipments.isLoading ? undefined : needing.length,
    'to-send': trips.isLoading ? undefined : toSend.length,
  }, tab, setTab)

  const ewayMissing = useMemo(() => tripsMissingEwayBill(toSend, shipments.data ?? []), [toSend, shipments.data])

  return (
    <Page>
      <PageHeader
        title="Dispatch"
        description="Get shipments onto trucks: give a vehicle to what has none, plan or optimize trips, then send them to the drivers."
      >
        <Tabs
          label="Dispatch"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'needs-vehicle', label: 'Needs a vehicle', count: shipments.isLoading ? undefined : needing.length },
            { id: 'to-send', label: 'Trips to send', count: trips.isLoading ? undefined : toSend.length },
            { id: 'plan', label: 'Plan a trip' },
            { id: 'optimize', label: 'Optimize' },
          ]}
        />
      </PageHeader>

      <TabPanel id={tab}>
        {tab === 'needs-vehicle' && (
          <NeedsVehicleTab
            rows={needing}
            loading={shipments.isLoading}
            error={shipments.isError}
            onRetry={() => shipments.refetch()}
            onOptimize={ids => {
              setOptimize({ ids, key: Date.now() })
              setTab('optimize')
            }}
          />
        )}
        {tab === 'to-send' && (
          <TripsToSendTab rows={toSend} loading={trips.isLoading} error={trips.isError} onRetry={() => trips.refetch()} ewayMissing={ewayMissing} />
        )}
        {tab === 'plan' && <RoutePlannerPage embedded onCreated={() => setTab('to-send')} />}
        {tab === 'optimize' && (
          <OptimizePage
            key={optimize?.key ?? 'all'}
            embedded
            initialShipmentIds={optimize?.ids}
            onReviewTrips={() => setTab('to-send')}
          />
        )}
      </TabPanel>
    </Page>
  )
}
