import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Copy } from 'lucide-react'
import { invoicesAPI, type PaymentDetails } from '@/services/api'
import { copyText } from '@/components/fleet/location/clipboard'
import { Button, Card } from '@/components/ui'

/** The lines to show and copy: one per detail the company has filled in. */
function paymentLines(d: PaymentDetails, invoiceNumber?: string): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: 'Account name', value: d.account_name },
    { label: 'Bank', value: d.bank_name },
    { label: 'Account number', value: d.bank_account_no },
    { label: 'IFSC', value: d.bank_ifsc },
    { label: 'UPI ID', value: d.upi_id },
  ]
  const lines = rows.filter((r): r is { label: string; value: string } => Boolean(r.value))
  if (invoiceNumber && lines.length > 0) lines.push({ label: 'Reference', value: invoiceNumber })
  return lines
}

/** Where to pay: the company's bank and UPI details from Settings, with a copy button. */
export default function HowToPay({ invoiceNumber, invoiceId }: { invoiceNumber?: string; invoiceId?: string }) {
  // With an invoice, the details of the company that issued it (each company has its own bank account)
  const details = useQuery({ queryKey: ['invoices', 'payment-details', invoiceId ?? null], queryFn: () => invoicesAPI.paymentDetails(invoiceId), staleTime: 5 * 60_000 })
  if (details.isLoading) return null

  const d = details.data
  const lines = d?.available ? paymentLines(d, invoiceNumber) : []
  const copy = async () => {
    const ok = await copyText(lines.map(l => `${l.label}: ${l.value}`).join('\n'))
    if (ok) toast.success('Payment details copied')
    else toast.error('We could not copy. Select the details and copy them.')
  }

  return (
    <Card padded className="space-y-3 !p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">How to pay</h3>
        {lines.length > 0 && <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={copy}>Copy details</Button>}
      </div>
      {lines.length > 0 && d ? (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {lines.map(l => (
              <div key={l.label}>
                <dt className="text-xs text-muted">{l.label}</dt>
                <dd className="tabular font-medium text-text">{l.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">
            Pay by bank transfer or UPI and quote the invoice number. Payment is due within {d.payment_terms_days} days of the invoice. MargixIndia marks it paid when the money arrives.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Payment details will be shared by MargixIndia.</p>
      )}
    </Card>
  )
}
