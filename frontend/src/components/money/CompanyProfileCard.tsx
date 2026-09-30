import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { financeAPI } from '@/services/api'
import { Button, Card, CardBody, CardHeader, ErrorState, Input, Skeleton, Textarea } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import type { CompanyProfile } from '@/utils/finance'

type Form = Record<Exclude<keyof CompanyProfile, 'payment_terms_days'>, string> & { payment_terms_days: string }

const toForm = (c: CompanyProfile): Form => ({
  legal_name: c.legal_name ?? '', gstin: c.gstin ?? '', pan: c.pan ?? '', address: c.address ?? '', city: c.city ?? '', state: c.state ?? '',
  pincode: c.pincode ?? '', phone: c.phone ?? '', email: c.email ?? '', sac_code: c.sac_code ?? '', bank_name: c.bank_name ?? '',
  bank_account_no: c.bank_account_no ?? '', bank_ifsc: c.bank_ifsc ?? '', upi_id: c.upi_id ?? '', invoice_footer: c.invoice_footer ?? '',
  payment_terms_days: String(c.payment_terms_days),
})

/** The seller on every invoice, and the payment terms new invoices are issued with. */
export function CompanyProfileCard() {
  const queryClient = useQueryClient()
  const company = useQuery({ queryKey: ['finance', 'company'], queryFn: () => financeAPI.company() })
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (company.data) setForm(toForm(company.data))
  }, [company.data])

  const save = useMutation({
    mutationFn: (data: Partial<CompanyProfile>) => financeAPI.saveCompany(data),
    onSuccess: data => {
      toast.success('Company details saved')
      queryClient.setQueryData(['finance', 'company'], data)
      queryClient.invalidateQueries({ queryKey: ['finance', 'invoice'] })
      setError(undefined)
    },
    onError: err => setError(errorMessage(err, 'We could not save the company details. Try again.')),
  })

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm(f => (f ? { ...f, [key]: e.target.value } : f))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    const terms = Number(form.payment_terms_days)
    if (!Number.isInteger(terms) || terms < 0 || terms > 365) { setError('Payment terms are a whole number of days, from 0 to 365'); return }
    setError(undefined)
    save.mutate({ ...form, payment_terms_days: terms })
  }

  return (
    <Card>
      <CardHeader title="Company and invoicing" description="Printed on every invoice as the seller. The GSTIN decides CGST and SGST or IGST. New invoices fall due after the payment terms." />
      <CardBody>
        {company.isLoading || !form ? (
          company.isError
            ? <ErrorState compact title="We could not load the company details" onRetry={() => company.refetch()} />
            : <Skeleton className="h-40 w-full" />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Company name" value={form.legal_name} onChange={set('legal_name')} className="sm:col-span-2" />
              <Input label="GSTIN" value={form.gstin} onChange={set('gstin')} maxLength={15} autoCapitalize="characters" />
              <Input label="PAN" value={form.pan} onChange={set('pan')} maxLength={10} autoCapitalize="characters" />
              <Textarea label="Address" value={form.address} onChange={set('address')} rows={2} className="sm:col-span-2" />
              <Input label="City" value={form.city} onChange={set('city')} />
              <Input label="State" value={form.state} onChange={set('state')} />
              <Input label="Pincode" value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} />
              <Input label="Phone" value={form.phone} onChange={set('phone')} type="tel" />
              <Input label="Email" value={form.email} onChange={set('email')} type="email" />
              <Input label="SAC code" value={form.sac_code} onChange={set('sac_code')} inputMode="numeric" maxLength={8} hint="The service code your accountant uses for freight" />
              <Input label="Payment terms" value={form.payment_terms_days} onChange={set('payment_terms_days')} inputMode="numeric" trailing="days" hint="Due date = issue date + terms. Default 15." />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Bank name" value={form.bank_name} onChange={set('bank_name')} />
              <Input label="Account number" value={form.bank_account_no} onChange={set('bank_account_no')} inputMode="numeric" />
              <Input label="IFSC" value={form.bank_ifsc} onChange={set('bank_ifsc')} maxLength={11} autoCapitalize="characters" />
              <Input label="UPI ID" value={form.upi_id} onChange={set('upi_id')} />
              <Textarea label="Invoice footer" value={form.invoice_footer} onChange={set('invoice_footer')} rows={2} className="sm:col-span-2" hint="Printed under the total, for example the jurisdiction" />
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" loading={save.isPending}>Save company details</Button>
          </form>
        )}
      </CardBody>
    </Card>
  )
}
