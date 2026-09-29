import VendorRequestsAdmin from '@/components/dashboard/VendorRequestsAdmin'
import { Page, PageHeader } from '@/components/ui'

export default function VendorRequestsPage() {
  return (
    <Page>
      <PageHeader title="Vendor requests" description="Loads posted by vendors that need a vehicle." />
      <VendorRequestsAdmin />
    </Page>
  )
}
