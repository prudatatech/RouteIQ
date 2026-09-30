import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { financeAPI } from '@/services/api'
import { openReceipt } from '@/services/expenseReceipts'
import {
  Button, DataTable, IconButton, SearchInput, Select, Stat, useConfirm, type Column, type DateRangeValue,
} from '@/components/ui'
import { downloadCsv, toCsv } from '@/utils/csv'
import { errorMessage, formatDate, formatRupees } from '@/utils/display'
import { EXPENSE_CATEGORIES, EXPENSE_CSV_COLUMNS, categoryLabel, expenseCsvRows, type Expense } from '@/utils/finance'
import ExpenseModal from './ExpenseModal'

/** The expense log for the chosen dates: add, edit, delete, filter and export. */
export default function ExpensesTab({ range }: { range: DateRangeValue }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Expense | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const list = useQuery<Expense[]>({
    queryKey: ['finance', 'expenses', range.from, range.to, category],
    queryFn: () => financeAPI.expenses({ from: range.from, to: range.to, category: category || undefined }) as Promise<Expense[]>,
  })

  const remove = useMutation({
    mutationFn: (id: string) => financeAPI.deleteExpense(id),
    onSuccess: () => {
      toast.success('Expense deleted')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not delete this expense. Try again.')),
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (list.data ?? []).filter(e => !q || [e.plate_number, e.note, categoryLabel(e.category)].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [list.data, search])
  const total = rows.reduce((s, e) => s + e.amount, 0)
  const filtered = !!(category || search)

  const openAdd = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (e: Expense) => { setEditing(e); setModalOpen(true) }

  const onDelete = async (e: Expense) => {
    const ok = await confirm({
      title: 'Delete this expense?',
      message: `${categoryLabel(e.category)} of ${formatRupees(e.amount)} on ${formatDate(e.expense_date)} will be removed from profit and loss.`,
      confirmLabel: 'Delete expense',
      tone: 'danger',
    })
    if (ok) remove.mutate(e.id)
  }

  const exportCsv = () => downloadCsv(`expenses-${range.from}-to-${range.to}.csv`, toCsv(expenseCsvRows(rows), EXPENSE_CSV_COLUMNS))

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Date', sortValue: e => e.expense_date, cell: e => formatDate(e.expense_date) },
    { key: 'category', header: 'Category', sortValue: e => categoryLabel(e.category), cell: e => categoryLabel(e.category) },
    {
      key: 'vehicle', header: 'Vehicle', hideBelow: 'md', sortValue: e => e.plate_number ?? '',
      cell: e => (e.plate_number ? <span className="font-mono text-sm">{e.plate_number}</span> : <span className="text-muted">—</span>),
    },
    {
      key: 'note', header: 'Note', hideBelow: 'lg',
      cell: e => <span className="line-clamp-1">{e.note || '—'}</span>,
    },
    {
      key: 'amount', header: 'Amount', align: 'right', sortValue: e => e.amount,
      cell: e => <span className="tabular font-medium">{formatRupees(e.amount)}</span>,
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', width: 'w-32',
      cell: e => (
        <div className="flex justify-end gap-1">
          {e.receipt_path && (
            <IconButton
              label="Open receipt"
              size="sm"
              icon={<Paperclip size={16} />}
              onClick={ev => { ev.stopPropagation(); openReceipt(e.id).catch(err => toast.error(err.message)) }}
            />
          )}
          <IconButton label="Edit expense" size="sm" icon={<Pencil size={16} />} onClick={ev => { ev.stopPropagation(); openEdit(e) }} />
          <IconButton label="Delete expense" size="sm" icon={<Trash2 size={16} />} onClick={ev => { ev.stopPropagation(); onDelete(e) }} />
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <SearchInput value={search} onChange={setSearch} label="Search expenses" placeholder="Search vehicle or note" className="sm:w-72" />
        <Select
          label="Category"
          hideLabel
          className="sm:w-48"
          value={category}
          onChange={e => setCategory(e.target.value)}
          options={[{ value: '', label: 'All categories' }, ...EXPENSE_CATEGORIES.map(c => ({ value: c.value, label: c.label }))]}
        />
        {filtered && <Button variant="ghost" onClick={() => { setCategory(''); setSearch('') }}>Clear filters</Button>}
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
          <Button icon={<Plus size={16} />} onClick={openAdd}>Add expense</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-lg">
        <Stat label="Expenses shown" loading={list.isLoading} value={rows.length.toLocaleString('en-IN')} />
        <Stat label="Total" loading={list.isLoading} value={formatRupees(total)} />
      </div>

      <DataTable
        caption="Expenses"
        columns={columns}
        rows={rows}
        rowKey={e => e.id}
        loading={list.isLoading}
        error={list.error ? 'We could not load expenses. Check your connection and try again.' : undefined}
        onRetry={() => list.refetch()}
        onRowClick={openEdit}
        initialSort={{ key: 'date', direction: 'desc' }}
        empty={filtered
          ? { title: 'No expenses match these filters', action: <Button variant="secondary" onClick={() => { setCategory(''); setSearch('') }}>Clear filters</Button> }
          : {
            title: 'No expenses in this range',
            description: 'Add fuel, maintenance, tolls and driver pay to see real profit.',
            action: <Button icon={<Plus size={16} />} onClick={openAdd}>Add expense</Button>,
          }}
      />

      <ExpenseModal open={modalOpen} expense={editing} onClose={() => setModalOpen(false)} />
    </div>
  )
}
