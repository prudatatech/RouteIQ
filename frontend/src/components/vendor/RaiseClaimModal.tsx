import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import ClaimDocuments from '@/components/cargo/ClaimDocuments'
import { CLAIM_TYPE_LABELS } from '@/components/cargo/logic'
import { CLAIM_TYPES, claimsAPI, type CargoClaim, type ClaimType } from '@/services/cargo'
import { errorMessage } from '@/utils/display'
import type { ClaimableLoad } from './loads'

const TYPE_HINTS: Record<ClaimType, string> = {
  damage: 'The goods arrived damaged.',
  shortage: 'Some pieces are missing.',
  loss: 'The whole load or a part of it was lost.',
  theft: 'The goods were stolen.',
  delay: 'The load arrived much later than promised.',
}

/**
 * Raise a claim on one of the vendor's own loads. Step one files it (type, amount, what happened);
 * step two adds the photos and papers with a signed upload. `loads` is one load, fixed, or several to choose from.
 */
export default function RaiseClaimModal({ open, loads, onClose, onFiled }: {
  open: boolean
  loads: ClaimableLoad[]
  onClose: () => void
  /** Called once the claim is filed, so the caller can refresh its lists. */
  onFiled: (claim: CargoClaim) => void
}) {
  const [manifestId, setManifestId] = useState(loads.length === 1 ? loads[0].manifest_id : '')
  const [type, setType] = useState<ClaimType | ''>('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [filed, setFiled] = useState<CargoClaim | null>(null)

  const amountNumber = amount.trim() === '' ? null : Number(amount.replace(/,/g, ''))
  const errors = {
    load: manifestId ? undefined : 'Choose the load.',
    type: type ? undefined : 'Choose what went wrong.',
    amount: amountNumber !== null && (!Number.isFinite(amountNumber) || amountNumber < 0) ? 'Enter an amount in rupees, or leave it empty.' : undefined,
    notes: notes.length > 2000 ? 'Keep this under 2,000 characters.' : undefined,
  }

  const create = useMutation({
    mutationFn: () => claimsAPI.create({
      ref: { manifest_id: manifestId },
      claim_type: type as ClaimType,
      ...(amountNumber !== null ? { claimed_amount: amountNumber } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }),
    onSuccess: claim => { setFiled(claim); onFiled(claim); toast.success(`Claim ${claim.code} filed.`) },
    onError: err => toast.error(errorMessage(err, 'We could not file the claim. Try again.')),
  })

  const submit = () => {
    setAttempted(true)
    if (errors.load || errors.type || errors.amount || errors.notes) return
    create.mutate()
  }

  const refreshFiled = async () => {
    if (!filed) return
    try { setFiled(await claimsAPI.get(filed.id)) } catch { /* the list refreshes on close */ }
  }

  if (filed) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={`Claim ${filed.code} filed`}
        description="MargixIndia has been told. Add photos or papers that show what happened: they speed things up."
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <ClaimDocuments claim={filed} readOnly={false} onSaved={refreshFiled} />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a claim"
      description="Claims can be raised on a delivered, partly delivered or lost load, within 7 days of delivery."
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={create.isPending}>File claim</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {loads.length > 1 && (
          <Select
            label="Load"
            required
            placeholder="Choose the load"
            value={manifestId}
            onChange={e => setManifestId(e.target.value)}
            options={loads.map(l => ({ value: l.manifest_id, label: l.label }))}
            error={attempted ? errors.load : undefined}
          />
        )}
        <Select
          label="What went wrong"
          required
          placeholder="Choose one"
          value={type}
          onChange={e => setType(e.target.value as ClaimType)}
          options={CLAIM_TYPES.map(t => ({ value: t, label: CLAIM_TYPE_LABELS[t] }))}
          hint={type ? TYPE_HINTS[type] : undefined}
          error={attempted ? errors.type : undefined}
        />
        <Input
          label="Amount you are claiming"
          inputMode="decimal"
          leading="₹"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          hint="Optional. Leave it empty if you are not sure yet."
          error={attempted ? errors.amount : undefined}
        />
        <Textarea
          label="What happened"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={2000}
          hint="For example: 3 of 40 cartons were wet when the receiver opened them."
          error={attempted ? errors.notes : undefined}
        />
      </div>
    </Modal>
  )
}
