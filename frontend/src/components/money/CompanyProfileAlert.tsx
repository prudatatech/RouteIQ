import { Link } from 'react-router-dom'
import { Alert, buttonClasses } from '@/components/ui'
import { INVOICE_PROFILE_MESSAGE } from '@/utils/finance'

/** Why no invoice can be issued yet, with the way to fix it. Shown on the Money page. */
export default function CompanyProfileAlert({ missing }: { missing: string[] }) {
  return (
    <Alert
      tone="warning"
      title={INVOICE_PROFILE_MESSAGE}
      action={<Link to="/admin/settings" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Open Settings</Link>}
    >
      {missing.length > 0 ? `Still missing: ${missing.join(', ')}. ` : ''}Deliveries wait here, and nothing is lost, until the details are saved under Company and invoicing.
    </Alert>
  )
}
