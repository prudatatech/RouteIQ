import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { financeAPI, routesAPI, vehiclesAPI, type ExpenseInput } from '@/services/api'
import { RECEIPT_TYPES, uploadReceipt } from '@/services/expenseReceipts'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { errorMessage, formatDate } from '@/utils/display'
import { EXPENSE_CATEGORIES, type Expense } from '@/utils/finance'

interface VehicleOption { id: string; plate_number: string }
interface RouteOption { id: string; status: string; created_at: string; total_distance_km: number | null }

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

interface FormState {
  category: string
  amount: string
  expense_date: string
  vehicle_id: string
  route_id: string
  litres: string
  note: string
}

const blank = (): FormState => ({ category: 'fuel', amount: '', expense_date: today(), vehicle_id: '', route_id: '', litres: '', note: '' })
const fromExpense = (e: Expense): FormState => ({
  category: e.category, amount: String(e.amount), expense_date: e.expense_date, vehicle_id: e.vehicle_id ?? '',
  route_id: e.route_id ?? '', litres: e.litres != null ? String(e.litres) : '', note: e.note ?? '',
})

/** Add or edit one expense, with an optional receipt. */
export default function ExpenseModal({ open, expense, onClose }: {
  open: boolean
  /** The expense being edited; leave out to add a new one. */
  expense?: Expense | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(blank)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [removeReceipt, setRemoveReceipt] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | 'receipt', string>>>({})

  useEffect(() => {
    if (!open) return
    setForm(expense ? fromExpense(expense) : blank())
    setReceipt(null)
    setRemoveReceipt(false)
    setErrors({})
  }, [open, expense])

  const vehicles = useQuery<VehicleOption[]>({
    queryKey: ['vehicles', 'options'],
    queryFn: () => vehiclesAPI.list() as Promise<VehicleOption[]>,
    enabled: open,
    staleTime: 60_000,
  })
  const routes = useQuery<RouteOption[]>({
    queryKey: ['routes', 'for-vehicle', form.vehicle_id],
    queryFn: () => routesAPI.list({ vehicle_id: form.vehicle_id }) as Promise<RouteOption[]>,
    enabled: open && !!form.vehicle_id,
    staleTime: 60_000,
  })

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }))

  const save = useMutation({
    mutationFn: async () => {
      const receiptPath = receipt ? await uploadReceipt(receipt) : removeReceipt ? null : undefined
      const litres = form.litres.trim()
      const payload: ExpenseInput = {
        category: form.category,
        amount: Number(form.amount),
        expense_date: form.expense_date,
        vehicle_id: form.vehicle_id || null,
        route_id: form.vehicle_id ? (form.route_id || null) : null,
        litres: form.category === 'fuel' && litres ? Number(litres) : null,
        note: form.note.trim() || null,
        ...(receiptPath !== undefined ? { receipt_path: receiptPath } : {}),
      }
      return expense ? financeAPI.updateExpense(expense.id, payload) : financeAPI.createExpense(payload)
    },
    onSuccess: () => {
      toast.success(expense ? 'Expense updated' : 'Expense added')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      onClose()
    },
    onError: err => toast.error(errorMessage(err, 'We could not save this expense. Try again.')),
  })

  const validate = () => {
    const next: typeof errors = {}
    const amount = Number(form.amount)
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) next.amount = 'Enter an amount greater than zero'
    if (!form.expense_date) next.expense_date = 'Choose the date of the expense'
    else if (form.expense_date > today()) next.expense_date = 'The date cannot be in the future'
    if (form.litres.trim() && !(Number(form.litres) > 0)) next.litres = 'Litres must be greater than zero'
    if (receipt && !RECEIPT_TYPES.includes(receipt.type)) next.receipt = 'Upload a PDF, JPG or PNG file'
    else if (receipt && receipt.size > MAX_RECEIPT_BYTES) next.receipt = 'The receipt must be 5 MB or smaller'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (validate()) save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={expense ? 'Edit expense' : 'Add expense'}
      description="Costs you enter here are counted in profit and loss."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="expense-form" loading={save.isPending}>{expense ? 'Save changes' : 'Add expense'}</Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Category"
          required
          value={form.category}
          onChange={e => set('category', e.target.value)}
          options={EXPENSE_CATEGORIES.map(c => ({ value: c.value, label: c.label }))}
        />
        <Input
          label="Amount"
          required
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          leading="₹"
          value={form.amount}
          onChange={e => set('amount', e.target.value)}
          error={errors.amount}
        />
        <Input
          label="Date"
          required
          type="date"
          max={today()}
          value={form.expense_date}
          onChange={e => set('expense_date', e.target.value)}
          error={errors.expense_date}
        />
        <Select
          label="Vehicle"
          hint="Leave empty for costs that are not for one vehicle."
          value={form.vehicle_id}
          onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value, route_id: '' }))}
          options={[{ value: '', label: 'No vehicle' }, ...(vehicles.data ?? []).map(v => ({ value: v.id, label: v.plate_number }))]}
        />
        {form.vehicle_id && (
          <Select
            label="Route"
            hint={routes.isError ? 'We could not load routes for this vehicle.' : 'Optional. Ties the cost to one trip.'}
            value={form.route_id}
            onChange={e => set('route_id', e.target.value)}
            disabled={routes.isLoading}
            options={[
              { value: '', label: 'No route' },
              ...(routes.data ?? []).map(r => ({
                value: r.id,
                label: `${formatDate(r.created_at)}${r.total_distance_km ? ` · ${Math.round(r.total_distance_km)} km` : ''} · ${r.status}`,
              })),
            ]}
          />
        )}
        {form.category === 'fuel' && (
          <Input
            label="Litres"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            trailing="L"
            hint="Optional."
            value={form.litres}
            onChange={e => set('litres', e.target.value)}
            error={errors.litres}
          />
        )}
        <Textarea
          className="sm:col-span-2"
          label="Note"
          rows={2}
          maxLength={500}
          value={form.note}
          onChange={e => set('note', e.target.value)}
        />
        <div className="sm:col-span-2">
          <Input
            label="Receipt"
            type="file"
            accept={RECEIPT_TYPES.join(',')}
            hint={expense?.receipt_path && !removeReceipt && !receipt ? 'A receipt is attached. Choose a file to replace it.' : 'Optional. PDF, JPG or PNG, up to 5 MB.'}
            error={errors.receipt}
            onChange={e => setReceipt(e.target.files?.[0] ?? null)}
          />
          {expense?.receipt_path && !receipt && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setRemoveReceipt(r => !r)}>
              {removeReceipt ? 'Keep the receipt' : 'Remove the receipt'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
