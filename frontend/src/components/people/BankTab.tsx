import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, EyeOff, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { peopleAPI, type IfscDetails } from '@/services/api'
import { Alert, BankBranchFields, Button, Card, CardHeader, Checkbox, EmptyState, IfscField, IfscVerifiedHint, Input, Modal, Select, StatusPill, Textarea, useConfirm } from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { errorMessage, formatDateTime } from '@/utils/display'
import { liveDocuments } from './docs'
import { namesDiffer } from './validators'
import type { BankAccount, PersonDetail } from './types'
const REVEAL_SECONDS = 30

/** Bank and payout details. The API sends the account number masked; only a superadmin can reveal it. */
export function BankTab({ detail, canReveal }: { detail: PersonDetail; canReveal: boolean }) {
  const { user, bank_accounts } = detail
  const [proof, setProof] = useState<{ url: string; name: string } | null>(null)
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['people'] })

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  const hide = (id: string) => {
    clearTimeout(timers.current[id])
    setRevealed(r => { const n = { ...r }; delete n[id]; return n })
  }

  const reveal = useMutation({
    mutationFn: (a: BankAccount) => peopleAPI.revealBankAccount(user.id, a.id),
    onSuccess: (res, a) => {
      setRevealed(r => ({ ...r, [a.id]: res.account_number }))
      timers.current[a.id] = setTimeout(() => hide(a.id), REVEAL_SECONDS * 1000)
    },
    onError: err => toast.error(errorMessage(err, 'We could not reveal the number. Try again.')),
  })
  const makePrimary = useMutation({
    mutationFn: (a: BankAccount) => peopleAPI.updateBankAccount(user.id, a.id, { is_primary: true }),
    onSuccess: () => { toast.success('Primary account changed'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not change the primary account. Try again.')),
  })
  const remove = useMutation({
    mutationFn: (a: BankAccount) => peopleAPI.deleteBankAccount(user.id, a.id),
    onSuccess: () => { toast.success('Bank account removed'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not remove this account. Try again.')),
  })

  const openProof = async (docId: string) => {
    try {
      const { url } = await peopleAPI.documentFile(user.id, docId)
      setProof({ url, name: 'Bank proof' })
    } catch (err) {
      toast.error(errorMessage(err, 'We could not open the proof. Try again.'))
    }
  }

  const askReveal = async (a: BankAccount) => {
    const ok = await confirm({
      title: 'Show the full account number?',
      message: 'This is recorded in their activity with your name. It hides again after 30 seconds.',
      confirmLabel: 'Show number',
    })
    if (ok) reveal.mutate(a)
  }
  const askRemove = async (a: BankAccount) => {
    const ok = await confirm({ title: 'Remove this bank account?', message: `${a.bank_name ?? 'Account'} ${a.account_number}`, confirmLabel: 'Remove account', tone: 'danger' })
    if (ok) remove.mutate(a)
  }

  return (
    <Card>
      <CardHeader
        title="Bank and payout"
        description="Where this person is paid. Numbers are hidden except the last 4 digits."
        actions={<Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Add account</Button>}
      />
      {bank_accounts.length === 0 ? (
        <EmptyState compact title="No bank details yet" description="Add an account or UPI ID so payouts can be made." action={<Button onClick={() => setEditing('new')}>Add account</Button>} />
      ) : (
        <ul className="divide-y divide-border">
          {bank_accounts.map(a => (
            <li key={a.id} className="space-y-2 px-4 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-text">{a.account_holder}</p>
                {a.is_primary && <StatusPill tone="brand" dot={false}>Primary</StatusPill>}
                <StatusPill tone={a.is_verified ? 'success' : 'warning'} dot={false}>{a.is_verified ? 'Verified' : 'Not verified'}</StatusPill>
                {a.effective_from && new Date(a.effective_from).getTime() > Date.now() && (
                  <StatusPill tone="info" dot={false}>Active from {formatDateTime(a.effective_from)}</StatusPill>
                )}
              </div>
              {namesDiffer(a.account_holder, user.full_name) && (
                <p className="text-xs text-warning">The account holder name is different from {user.full_name}.{a.verification_note ? ` Verified with note: ${a.verification_note}` : ''}</p>
              )}
              <p className="text-sm text-muted">
                {a.bank_name ? `${a.bank_name} · ` : ''}<span className="font-mono">{revealed[a.id] ?? a.account_number}</span> · IFSC <span className="font-mono">{a.ifsc}</span>
                {a.upi_id && <> · UPI <span className="font-mono">{a.upi_id}</span></>}
              </p>
              <p className="text-xs text-muted">
                {[a.branch_name, a.bank_city, a.bank_state].filter(Boolean).join(', ') || 'Branch not recorded'} · <IfscVerifiedHint verifiedAt={a.ifsc_verified_at} />
              </p>
              <div className="flex flex-wrap gap-2">
                {a.proof_document_id && <Button variant="secondary" size="sm" icon={<Eye size={16} />} onClick={() => openProof(a.proof_document_id!)}>View proof</Button>}
                <Button variant="secondary" size="sm" icon={<Pencil size={16} />} onClick={() => setEditing(a)}>Edit</Button>
                {!a.is_primary && <Button variant="secondary" size="sm" icon={<Star size={16} />} loading={makePrimary.isPending && makePrimary.variables?.id === a.id} onClick={() => makePrimary.mutate(a)}>Make primary</Button>}
                {canReveal && (revealed[a.id]
                  ? <Button variant="ghost" size="sm" icon={<EyeOff size={16} />} onClick={() => hide(a.id)}>Hide number</Button>
                  : <Button variant="ghost" size="sm" icon={<Eye size={16} />} loading={reveal.isPending && reveal.variables?.id === a.id} onClick={() => askReveal(a)}>Reveal</Button>)}
                <Button variant="ghost" size="sm" icon={<Trash2 size={16} />} onClick={() => askRemove(a)}>Remove</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <BankModal detail={detail} account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {proof && <DocumentViewerModal isOpen onClose={() => setProof(null)} fileUrl={proof.url} fileName={proof.name} />}
    </Card>
  )
}

function BankModal({ detail, account, onClose, onDone }: {
  detail: PersonDetail; account: BankAccount | null; onClose: () => void; onDone: () => void
}) {
  const personId = detail.user.id
  const proofDocs = liveDocuments(detail.documents).filter(d => d.doc_type === 'bank_proof')
  const [proofId, setProofId] = useState(account?.proof_document_id ?? '')
  const [note, setNote] = useState(account?.verification_note ?? '')
  const [holder, setHolder] = useState(account?.account_holder ?? detail.user.full_name ?? '')
  const [number, setNumber] = useState('')
  const [ifsc, setIfsc] = useState(account?.ifsc ?? '')
  const [bank, setBank] = useState(account?.bank_name ?? '')
  const [branch, setBranch] = useState(account?.branch_name ?? '')
  const [ifscInfo, setIfscInfo] = useState<IfscDetails | null>(null)
  const [upi, setUpi] = useState(account?.upi_id ?? '')
  const [primary, setPrimary] = useState(account?.is_primary ?? false)
  const [verified, setVerified] = useState(account?.is_verified ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: () => {
      const data: Partial<BankAccount> = {
        account_holder: holder.trim(), ifsc: ifsc.trim().toUpperCase(), bank_name: bank.trim() || null,
        upi_id: upi.trim() || null, is_primary: primary, is_verified: verified,
        proof_document_id: proofId || null, ...(note.trim() ? { verification_note: note.trim() } : {}),
        ...(number.trim() ? { account_number: number.replace(/\s/g, '') } : {}),
      }
      return account ? peopleAPI.updateBankAccount(personId, account.id, data) : peopleAPI.addBankAccount(personId, data)
    },
    onSuccess: (saved: { warning_messages?: string[] }) => {
      toast.success(account ? 'Bank account saved' : 'Bank account added')
      for (const w of saved?.warning_messages ?? []) toast(w, { duration: 8000 })
      onDone(); onClose()
    },
    onError: err => toast.error(errorMessage(err, 'We could not save the bank account. Check the details and try again.')),
  })

  const mismatch = namesDiffer(holder, detail.user.full_name)
  const submit = () => {
    const e: Record<string, string> = {}
    if (!holder.trim()) e.holder = 'Enter the account holder name.'
    if (!account && !number.trim()) e.number = 'Enter the account number.'
    if (number.trim() && !/^\d{9,18}$/.test(number.replace(/\s/g, ''))) e.number = 'Account numbers are 9 to 18 digits.'
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) e.ifsc = 'IFSC looks like HDFC0001234.'
    if (mismatch && verified && !note.trim()) e.note = 'Say why this account is in a different name.'
    setErrors(e)
    if (Object.keys(e).length === 0) save.mutate()
  }

  return (
    <Modal
      open onClose={onClose} title={account ? 'Edit bank account' : 'Add bank account'} closeOnBackdrop={!save.isPending} onSubmit={submit}
      footer={<><Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button type="submit" loading={save.isPending}>Save account</Button></>}
    >
      <div className="space-y-4">
        <Input label="Account holder" required value={holder} onChange={e => setHolder(e.target.value)} error={errors.holder} data-autofocus />
        <Input label="Account number" required={!account} inputMode="numeric" autoComplete="off" value={number} onChange={e => setNumber(e.target.value)} error={errors.number}
          hint={account ? `Leave blank to keep ${account.account_number}.` : undefined} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <IfscField label="IFSC" required value={ifsc} onChange={setIfsc} onResolved={setIfscInfo} error={errors.ifsc} className="sm:col-span-2" />
        </div>
        <BankBranchFields details={ifscInfo} bankName={bank} branch={branch} onBankName={setBank} onBranch={setBranch} />
        <Input label="UPI ID" value={upi} onChange={e => setUpi(e.target.value)} hint="Optional, for example name@bank." />
        <Checkbox label="Primary account" description="Payouts go here." checked={primary} onChange={e => setPrimary(e.target.checked)} />
        {proofDocs.length > 0 ? (
          <Select label="Proof of account" value={proofId} onChange={e => setProofId(e.target.value)} placeholder="None"
            options={proofDocs.map(d => ({ value: d.id, label: `Bank proof, added ${formatDateTime(d.created_at)}` }))} />
        ) : (
          <p className="text-xs text-muted">To attach proof, upload a cancelled cheque or passbook as "Bank proof" on the Documents tab first.</p>
        )}
        {mismatch && <Alert tone="warning">The account holder name is different from {detail.user.full_name}. Verifying needs a note.</Alert>}
        <Checkbox label="Verified" description="Tick once you have checked the details against a cancelled cheque or passbook." checked={verified} onChange={e => setVerified(e.target.checked)} />
        {(verified && mismatch) && <Textarea label="Note" required rows={2} value={note} onChange={e => setNote(e.target.value)} error={errors.note} />}
        {!account && <p className="text-xs text-muted">A new account is only used for payouts after the safety wait set in Settings. You and every superadmin are told about the change.</p>}
      </div>
    </Modal>
  )
}
