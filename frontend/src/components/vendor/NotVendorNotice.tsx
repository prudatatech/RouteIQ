import { Alert } from '@/components/ui'
import type { AccountKind } from '@/utils/accountKind'

/** Shown to a signed-in company staff or 3PL account on the vendor pages, where posting loads and bidding are disabled for them. */
export default function NotVendorNotice({ kind }: { kind: Exclude<AccountKind, 'vendor'> }) {
  const who = kind === 'tpl' ? 'a 3PL partner' : 'company staff'
  return (
    <Alert tone="info">
      {`You're signed in as ${who}. Posting loads needs a vendor account.`}
    </Alert>
  )
}
