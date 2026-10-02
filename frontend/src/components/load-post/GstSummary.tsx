import { Card } from '@/components/ui'
import type { AssistTax } from '@/types/load'
import { inr } from './logic'

const th = 'px-3 py-2 text-left text-xs font-medium text-muted'
const td = 'px-3 py-2 text-sm tabular'

/**
 * The GST summary on the review step (PRD 8.3): by rate, then line by line, then CGST + SGST or
 * IGST and the grand total. The numbers come from the server's /public/loads/assist answer.
 */
export default function GstSummary({ tax, hasValue, loading }: { tax: AssistTax | null; hasValue: boolean; loading?: boolean }) {
  if (!hasValue) {
    return <Card padded className="!p-4"><h3 className="text-base font-semibold text-text">GST summary</h3><p className="mt-1 text-sm text-muted">To be calculated on invoice. Add the declared value of your goods to see it here.</p></Card>
  }
  if (!tax) {
    return <Card padded className="!p-4"><h3 className="text-base font-semibold text-text">GST summary</h3><p className="mt-1 text-sm text-muted">{loading ? 'Working out the GST…' : 'The GST will be calculated on the invoice.'}</p></Card>
  }
  const split = tax.basis === 'inter'
    ? [{ label: 'IGST', value: tax.igst }]
    : tax.basis === 'intra'
      ? [{ label: 'CGST', value: tax.cgst }, { label: 'SGST', value: tax.sgst }]
      : []
  return (
    <Card padded className="space-y-4 !p-4">
      <h3 className="text-base font-semibold text-text">GST summary</h3>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px]" aria-label="GST by rate">
          <thead><tr className="border-b border-border"><th className={th}>GST rate</th><th className={`${th} text-right`}>Taxable value</th><th className={`${th} text-right`}>GST</th></tr></thead>
          <tbody>
            {tax.by_rate.map(r => (
              <tr key={r.rate} className="border-b border-border last:border-0">
                <td className={td}>{r.rate}%</td><td className={`${td} text-right`}>{inr(r.taxable)}</td><td className={`${td} text-right`}>{inr(r.gst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]" aria-label="GST by product">
          <thead><tr className="border-b border-border">
            <th className={th}>Item</th><th className={`${th} text-right`}>Taxable value</th><th className={`${th} text-right`}>GST rate</th><th className={`${th} text-right`}>GST amount</th><th className={`${th} text-right`}>Total</th>
          </tr></thead>
          <tbody>
            {tax.lines.map((l, i) => (
              <tr key={`${l.hsn}-${i}`} className="border-b border-border">
                <td className={td}>{l.product} <span className="text-muted">(HSN {l.hsn})</span></td>
                <td className={`${td} text-right`}>{inr(l.taxable)}</td>
                <td className={`${td} text-right`}>{l.rate}%</td>
                <td className={`${td} text-right`}>{inr(l.gst)}</td>
                <td className={`${td} text-right`}>{inr(l.taxable + l.gst)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>Total</td><td className={`${td} text-right`}>{inr(tax.taxable)}</td><td className={`${td} text-right`}>—</td>
              <td className={`${td} text-right`}>{inr(tax.gst_total)}</td><td className={`${td} text-right`}>{inr(tax.grand_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {split.map(s => (<div key={s.label} className="contents"><dt className="text-muted">{s.label}</dt><dd className="text-right tabular text-text">{inr(s.value)}</dd></div>))}
        <dt className="text-muted">Total GST</dt><dd className="text-right tabular text-text">{inr(tax.gst_total)}</dd>
        <dt className="font-semibold text-text">Grand total</dt><dd className="text-right font-semibold tabular text-text">{inr(tax.grand_total)}</dd>
      </dl>
      {split.length === 0 && <p className="text-xs text-muted">Add both pin codes to see whether CGST + SGST or IGST applies.</p>}
    </Card>
  )
}
