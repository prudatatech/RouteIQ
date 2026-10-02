import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import type { InfoRequestInput } from './types'

export const MAX_REQUEST_ITEMS = 10

interface Row { label: string; kind: 'text' | 'document'; hint: string }
const blank = (): Row => ({ label: '', kind: 'text', hint: '' })

/** Builds the payload, or says which rows are missing a label. Exported for the tests. */
export function buildRequest(message: string, rows: Row[]): { ok: true; data: { message?: string; items: InfoRequestInput[] } } | { ok: false; error: string } {
  if (rows.length === 0) return { ok: false, error: 'Add at least one item to ask for.' }
  if (rows.length > MAX_REQUEST_ITEMS) return { ok: false, error: `Ask for at most ${MAX_REQUEST_ITEMS} items.` }
  if (rows.some(r => !r.label.trim())) return { ok: false, error: 'Give every item a name.' }
  return {
    ok: true,
    data: {
      ...(message.trim() ? { message: message.trim() } : {}),
      items: rows.map(r => ({ label: r.label.trim(), kind: r.kind, ...(r.hint.trim() ? { hint: r.hint.trim() } : {}) })),
    },
  }
}

export function AskMoreDetailsModal({ open, vendorName, busy, onClose, onSubmit }: {
  open: boolean
  vendorName: string
  busy: boolean
  onClose: () => void
  onSubmit: (data: { message?: string; items: InfoRequestInput[] }) => void
}) {
  const [message, setMessage] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, patch: Partial<Row>) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const submit = () => {
    const built = buildRequest(message, rows)
    if (!built.ok) { setError(built.error); return }
    setError(null)
    onSubmit(built.data)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Ask ${vendorName} for more details`}
      description="The vendor sees this when they sign in, answers each item, and the KYC comes back to you for review."
      onSubmit={submit}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Send request</Button>
        </>
      )}
    >
      <div className="space-y-5">
        <Textarea label="Message (optional)" value={message} onChange={e => setMessage(e.target.value)} placeholder="Anything the vendor should know" rows={2} />
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text">What do you need?</legend>
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-control border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <Input label={`Item ${i + 1}`} value={r.label} onChange={e => update(i, { label: e.target.value })} placeholder="For example: Latest GST return" maxLength={120} />
                <Select
                  label="Answer as"
                  value={r.kind}
                  onChange={e => update(i, { kind: e.target.value as Row['kind'] })}
                  options={[{ value: 'text', label: 'Text' }, { value: 'document', label: 'Document' }]}
                />
              </div>
              <Input label="Hint (optional)" value={r.hint} onChange={e => update(i, { hint: e.target.value })} placeholder="Help the vendor answer" maxLength={200} />
              {rows.length > 1 && (
                <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}>Remove</Button>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" icon={<Plus size={14} />} disabled={rows.length >= MAX_REQUEST_ITEMS} onClick={() => setRows(prev => [...prev, blank()])}>Add another item</Button>
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
