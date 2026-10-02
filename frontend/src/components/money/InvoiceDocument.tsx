import { Fragment } from 'react'
import { formatDate, formatRupees } from '@/utils/display'
import { paymentMethodLabel, type InvoiceDetail } from '@/utils/finance'

const Missing = ({ children }: { children: string }) => <span className="text-muted">{children}</span>

function Party({ title, name, missing, lines }: { title: string; name: string | null; missing: string; lines: (string | null | undefined)[] }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-1 break-words text-base font-semibold text-text">{name ?? <Missing>{missing}</Missing>}</p>
      <div className="mt-1 space-y-0.5 text-sm text-muted">
        {lines.filter(Boolean).map((l, i) => <p key={i} className="break-words">{l}</p>)}
      </div>
    </div>
  )
}

/** The invoice as a GST tax invoice: seller, buyer, lines, tax split, total in words and how it stands. */
export default function InvoiceDocument({ inv }: { inv: InvoiceDetail }) {
  const s = inv.seller
  const b = inv.buyer
  const taxRows: { label: string; value: number }[] = inv.tax.basis === 'intra'
    ? [{ label: `CGST @ ${inv.tax.rate / 2}%`, value: inv.tax.cgst }, { label: `SGST @ ${inv.tax.rate / 2}%`, value: inv.tax.sgst }]
    : inv.tax.basis === 'inter'
      ? [{ label: `IGST @ ${inv.tax.rate}%`, value: inv.tax.igst }]
      : inv.tax.basis === 'unknown'
        ? [{ label: `GST @ ${inv.tax.rate}%`, value: inv.tax.total }]
        : []

  return (
    <article aria-label={`Tax invoice ${inv.invoice_number ?? ''}`} className="space-y-6 rounded-card border border-border bg-surface p-4 sm:p-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <Party
          title="From"
          name={s.legal_name}
          missing="Company name not set"
          lines={[
            [s.address, s.city, s.state, s.pincode].filter(Boolean).join(', '),
            s.gstin ? `GSTIN ${s.gstin}${s.state_name ? ` · ${s.state_name} (${s.state_code})` : ''}` : 'GSTIN not set',
            s.pan ? `PAN ${s.pan}` : null,
            [s.phone, s.email].filter(Boolean).join(' · '),
          ]}
        />
        <Party
          title="Billed to"
          name={b.name}
          missing="No recipient on record for this delivery"
          lines={[
            b.kind === 'consignee' ? 'Consignee on the shipment' : null,
            b.address,
            b.gstin ? `GSTIN ${b.gstin}${b.state ? ` · ${b.state} (${b.state_code})` : ''}` : 'No GSTIN on record',
            [b.phone, b.email].filter(Boolean).join(' · '),
          ]}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
        {[
          ['Invoice number', <span key="n" className="font-mono">{inv.invoice_number ?? '—'}</span>],
          ['Invoice date', formatDate(inv.issued_at)],
          ['Due date', <span key="d">{formatDate(inv.due_date)}<span className="block text-xs text-muted">{inv.payment_terms_days} day terms</span></span>],
          ['Place of supply', b.state ? `${b.state} (${b.state_code})` : <Missing key="p">Not recorded</Missing>],
          ...(inv.load_number ? [['Load', <span key="l" className="font-mono">Load {inv.load_number}</span>]] : []),
        ].map(([label, value], i) => (
          <div key={i} className="min-w-0">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 break-words text-sm text-text">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Lines: a table from sm up, stacked on phones */}
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">Description</th>
              <th scope="col" className="py-2 pr-4 font-medium">SAC</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Qty</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Rate</th>
              <th scope="col" className="py-2 text-right font-medium">Taxable value</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b border-border align-top">
                <td className="py-3 pr-4">{l.description}</td>
                <td className="py-3 pr-4 tabular">{l.sac_code ?? <Missing>Not set</Missing>}</td>
                <td className="py-3 pr-4 text-right tabular">{l.quantity}</td>
                <td className="py-3 pr-4 text-right tabular">{formatRupees(l.unit_price)}</td>
                <td className="py-3 text-right tabular">{formatRupees(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border border-y border-border sm:hidden">
        {inv.lines.map((l, i) => (
          <li key={i} className="space-y-1 py-3 text-sm">
            <p className="break-words text-text">{l.description}</p>
            <p className="text-muted">SAC {l.sac_code ?? 'not set'} · Qty {l.quantity}</p>
            <p className="tabular font-medium text-text">{formatRupees(l.amount)}</p>
          </li>
        ))}
      </ul>

      {inv.goods.length > 0 && (
        <p className="break-words text-sm text-muted">
          Goods carried:{' '}
          {inv.goods.map((g, i) => (
            <Fragment key={i}>
              {i > 0 && '; '}HSN {g.hsn_code ?? '—'}{g.description ? ` (${g.description})` : ''}{g.gst_rate != null ? ` at ${g.gst_rate}%` : ''}
            </Fragment>
          ))}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="min-w-0 space-y-3 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Amount in words</p>
            <p className="mt-1 break-words font-medium text-text">{inv.total_in_words || '—'}</p>
          </div>
          {inv.reverse_charge?.note && <p className="font-medium text-text">{inv.reverse_charge.note}</p>}
          {inv.tax.note && <p className="text-muted">{inv.tax.note}</p>}
          {inv.status === 'issued' && (s.bank_account_no || s.upi_id) && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">How to pay</p>
              <div className="mt-1 space-y-0.5 break-words text-text">
                {s.bank_name && <p>{s.bank_name}</p>}
                {s.bank_account_no && <p>A/c {s.bank_account_no}{s.bank_ifsc ? ` · IFSC ${s.bank_ifsc}` : ''}</p>}
                {s.upi_id && <p>UPI {s.upi_id}</p>}
              </div>
            </div>
          )}
          {inv.status === 'paid' && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Payment</p>
              <p className="mt-1 break-words text-text">
                Paid {formatDate(inv.paid_at)}{inv.payment_method ? ` by ${paymentMethodLabel(inv.payment_method)}` : ''}
                {inv.payment_reference ? `, ref. ${inv.payment_reference}` : ''}
              </p>
            </div>
          )}
          {inv.status === 'void' && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Voided</p>
              <p className="mt-1 break-words text-text">{formatDate(inv.voided_at)}{inv.void_reason ? `: ${inv.void_reason}` : ''}</p>
            </div>
          )}
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">Taxable value</dt><dd className="tabular">{formatRupees(inv.amount)}</dd></div>
          {taxRows.map(r => (
            <div key={r.label} className="flex justify-between gap-4"><dt className="text-muted">{r.label}</dt><dd className="tabular">{formatRupees(r.value)}</dd></div>
          ))}
          {inv.tax.basis === 'none' && <div className="flex justify-between gap-4"><dt className="text-muted">GST</dt><dd className="text-muted">None charged</dd></div>}
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold text-text">
            <dt>Total</dt><dd className="tabular">{formatRupees(inv.total)}</dd>
          </div>
        </dl>
      </div>

      {s.invoice_footer && <p className="border-t border-border pt-4 text-xs text-muted">{s.invoice_footer}</p>}
    </article>
  )
}
