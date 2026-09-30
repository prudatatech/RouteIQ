import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Page, PageHeader, TabPanel, Tabs, useTabParam, type TabItem } from '@/components/ui'
import OpenWindowModal from '@/components/backhaul/OpenWindowModal'
import PoolTools from '@/components/backhaul/PoolTools'
import OpenReturnTripsTab from '@/components/returnTrips/OpenReturnTripsTab'
import BidsToDecideTab from '@/components/returnTrips/BidsToDecideTab'
import PartnersTab from '@/components/tpl/PartnersTab'
import { returnTripKeys, useReturnTripsBoard, windowState } from '@/components/returnTrips/data'
import { useNow } from '@/hooks/useNow'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'

export const RETURN_TRIP_TABS = ['open', 'bids', 'pool', 'partners'] as const
export type ReturnTripTab = typeof RETURN_TRIP_TABS[number]

/**
 * Return trips: spare truck space in one place. Open return trips vendors can bid on, the bids waiting for a
 * decision, the loads to pool or match, and the 3PL partners who carry what the fleet can't.
 * A link with `?open=<bid, return trip or partner id>` goes to the right tab and opens that item.
 */
export default function ReturnTripsPage() {
  const now = useNow(15_000)
  const [tab, setTab] = useTabParam<ReturnTripTab>(RETURN_TRIP_TABS, 'open')
  const [searchParams, setSearchParams] = useSearchParams()
  const [opening, setOpening] = useState(false)
  const [selectedBidId, setSelectedBidId] = useState<string | null>(null)
  const [focusWindowId, setFocusWindowId] = useState<string | null>(null)

  const board = useReturnTripsBoard()
  useRealtimeRefresh('return_trips_board', ['capacity_windows', 'capacity_bids'], [returnTripKeys.board])
  useRealtimeRefresh('return_trips_confirmations', ['driver_confirmations'], [returnTripKeys.confirmations])

  // A link (a notification) names a bid or a return trip: switch to the tab it belongs on and open it.
  // Partner links are handled by the partners tab itself.
  const openId = searchParams.get('open')
  useEffect(() => {
    if (!openId || tab === 'partners' || tab === 'pool' || board.isLoading) return
    const data = board.data
    const bid = data?.bids.find(b => b.id === openId)
    const win = data?.windows.find(w => w.id === openId) ?? (bid ? data?.windows.find(w => w.id === bid.window_id) : undefined)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('open')
      if (win) {
        const siblings = data!.bids.filter(b => b.window_id === win.id)
        const target: ReturnTripTab = bid || siblings.some(b => b.status === 'pending') ? 'bids' : 'open'
        if (target === 'open') next.delete('tab'); else next.set('tab', target)
      }
      return next
    }, { replace: true })
    if (!win) return
    if (bid) setSelectedBidId(bid.id)
    setFocusWindowId(win.id)
  }, [openId, tab, board.isLoading, board.data, setSearchParams])

  const seeBids = (windowId: string) => {
    setFocusWindowId(windowId)
    setTab('bids')
  }

  const counts = useMemo(() => {
    const data = board.data
    if (!data) return { open: undefined, bids: undefined }
    const windows = new Map(data.windows.map(w => [w.id, w]))
    const open = data.windows.filter(w => windowState(w, data.bids.filter(b => b.window_id === w.id), now) === 'open').length
    const bids = data.bids.filter(b => {
      const w = windows.get(b.window_id)
      return b.status === 'pending' && w && !w.winning_bid_id && w.status !== 'cancelled'
    }).length
    return { open, bids }
  }, [board.data, now])

  const tabs: TabItem<ReturnTripTab>[] = [
    { id: 'open', label: 'Open return trips', count: counts.open },
    { id: 'bids', label: 'Bids to decide', count: counts.bids },
    { id: 'pool', label: 'Combine loads' },
    { id: 'partners', label: '3PL partners' },
  ]

  return (
    <Page>
      <PageHeader
        title="Return trips"
        description="Spare truck space: open it to vendors, decide their bids, fill it with loads, or hand loads to 3PL partners."
        actions={<Button icon={<Plus size={16} />} onClick={() => setOpening(true)}>Open a return trip</Button>}
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Return trips sections" />
      </PageHeader>

      <TabPanel id={tab}>
        {tab === 'open' && (
          <OpenReturnTripsTab board={board} now={now} focusWindowId={focusWindowId} onOpenReturnTrip={() => setOpening(true)} onSeeBids={seeBids} />
        )}
        {tab === 'bids' && (
          <BidsToDecideTab board={board} now={now} selectedBidId={selectedBidId} onSelectBid={setSelectedBidId} focusWindowId={focusWindowId} />
        )}
        {tab === 'pool' && <PoolTools />}
        {tab === 'partners' && <PartnersTab />}
      </TabPanel>

      <OpenWindowModal open={opening} onClose={() => setOpening(false)} />
    </Page>
  )
}
