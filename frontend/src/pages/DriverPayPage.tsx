import { Page, PageHeader } from '@/components/ui'
import DriverPayTab from '@/components/money/DriverPayTab'

/** Driver pay on its own address (/money/driver-pay); the Money section shows the same tab. */
export default function DriverPayPage() {
  return (
    <Page>
      <PageHeader title="Driver pay" description="What each vehicle type pays per trip and per km, what drivers earned, and payouts." />
      <DriverPayTab />
    </Page>
  )
}
