import { PageHeader } from '@/components/ui'
import { TplOrdersTab } from '@/components/tpl/TplOrdersTab'
import { usePortal } from './portalContext'

/** Orders, the portal's home: offers to accept, then the orders to update. */
export default function OrdersPage() {
  const { partner } = usePortal()
  return (
    <div className="space-y-6">
      <PageHeader title="Orders" description="Loads offered to you, and the orders you are carrying." />
      <TplOrdersTab canAccept={partner.status === 'active'} />
    </div>
  )
}
