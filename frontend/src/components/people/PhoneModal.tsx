import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { peopleAPI } from '@/services/api'
import { Alert, Button, Input, Modal, useConfirm } from '@/components/ui'
import { errorMessage, formatDate } from '@/utils/display'
import { DuplicateNotice } from './DuplicateNotice'
import { useDuplicates } from './useDuplicates'
import { personName, toE164, type PersonDetail } from './types'

/** Change a person's mobile number (new SIM or phone). The old number is kept in their history. */
export function PhoneModal({ detail, open, onClose }: { detail: PersonDetail; open: boolean; onClose: () => void }) {
  const { user, profile, phone_history } = detail
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const e164 = toE164(phone)
  const dup = useDuplicates({ phone: e164 ?? undefined }, open && !!e164 && e164 !== user.phone, user.id)

  const close = () => { setPhone(''); setError(''); onClose() }
  const save = useMutation({
    mutationFn: () => peopleAPI.update(user.id, { phone: e164, updated_at: profile?.updated_at }),
    onSuccess: () => { toast.success('Phone number changed'); queryClient.invalidateQueries({ queryKey: ['people'] }); close() },
    onError: err => setError(errorMessage(err, 'We could not change the number. Try again.')),
  })

  const submit = async () => {
    if (!e164) { setError('Enter a 10-digit mobile number.'); return }
    if (e164 === user.phone) { setError('This is already their number.'); return }
    if (dup.matches.length > 0) { setError('This number already belongs to someone on file.'); return }
    setError('')
    const ok = await confirm({
      title: `Change ${personName(user)}'s number?`,
      message: user.role === 'driver'
        ? 'They will sign in to the driver app with a one-time code sent to the new number, and land on this same record.'
        : 'Their old number is kept in their history.',
      confirmLabel: 'Change number',
    })
    if (ok) save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change phone number"
      description={`Now: ${user.phone ?? 'not set'}`}
      closeOnBackdrop={!save.isPending}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Change number</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="New mobile number" required type="tel" inputMode="numeric" data-autofocus value={phone} onChange={e => { setPhone(e.target.value); setError('') }}
          hint="10-digit number. The old number cannot be given to anyone else for 90 days." />
        <DuplicateNotice matches={dup.matches} what="mobile number" onNavigate={close} />
        {error && <Alert tone="danger">{error}</Alert>}
        {phone_history && phone_history.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium text-text">Previous numbers</p>
            <ul className="space-y-1 text-sm text-muted">
              {phone_history.map((h, i) => (
                <li key={i}><span className="font-mono text-text">{h.phone}</span>{h.from_at || h.to_at ? ` · ${h.from_at ? formatDate(h.from_at) : 'earlier'} to ${h.to_at ? formatDate(h.to_at) : 'now'}` : ''}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
