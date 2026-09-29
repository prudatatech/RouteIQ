import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { peopleAPI } from '@/services/api'
import { Alert, Button, Input, Modal, Select, Textarea, useConfirm } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { STATUS_OPTIONS, personName, statusLabel, type PersonStatus, type PersonUser } from './types'

const NEEDS_REASON: PersonStatus[] = ['suspended', 'inactive']
const CONSEQUENCE: Record<PersonStatus, string> = {
  active: 'They can sign in and be dispatched again.',
  onboarding: 'They can sign in while you finish their documents. Their history, documents and employee code are kept.',
  on_leave: 'They can still sign in but are not dispatched. They return to active on the last day of leave.',
  suspended: 'They are signed out and cannot sign in until you make them active again. Work assigned to them is released.',
  inactive: 'They have left. They are signed out and cannot sign in. Their history is kept, and you can reactivate them if they return.',
}

/**
 * Change a person's status. Suspended and left need a reason, on leave needs dates, every change
 * is confirmed, and the server's refusals (for example "on route X") are shown in the dialog.
 * `preset` opens the dialog on one status, used for "Reactivate".
 */
export function StatusModal({ person, open, onClose, preset }: {
  person: PersonUser; open: boolean; onClose: () => void; preset?: PersonStatus
}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [status, setStatus] = useState<PersonStatus | ''>('')
  const [reason, setReason] = useState('')
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { if (open) setStatus(preset ?? '') }, [open, preset])
  const close = () => { setStatus(''); setReason(''); setFrom(''); setUntil(''); setError(''); onClose() }

  const change = useMutation({
    mutationFn: (s: PersonStatus) => peopleAPI.setStatus(person.id, s, reason.trim() || undefined, {
      ...(s === 'on_leave' ? { leave_from: from, leave_until: until } : {}),
      ...(s === 'suspended' && until ? { suspended_until: until } : {}),
    }),
    onSuccess: (_d, s) => {
      toast.success(`${personName(person)} is now ${statusLabel(s).toLowerCase()}`)
      queryClient.invalidateQueries({ queryKey: ['people'] })
      close()
    },
    onError: err => setError(errorMessage(err, 'We could not change the status. Try again.')),
  })

  const submit = async () => {
    if (!status) { setError('Choose a status.'); return }
    if (NEEDS_REASON.includes(status) && !reason.trim()) { setError('Give a reason. It is kept in their history.'); return }
    if (status === 'on_leave' && (!from || !until)) { setError('Enter the first and last day of leave.'); return }
    if (status === 'on_leave' && until < from) { setError('The last day of leave is before the first day.'); return }
    setError('')
    const ok = await confirm({
      title: preset === 'onboarding' ? `Reactivate ${personName(person)}?` : `Make ${personName(person)} ${statusLabel(status).toLowerCase()}?`,
      message: CONSEQUENCE[status],
      confirmLabel: preset === 'onboarding' ? 'Reactivate person' : `Make ${statusLabel(status).toLowerCase()}`,
      tone: NEEDS_REASON.includes(status) ? 'danger' : 'primary',
    })
    if (ok) change.mutate(status)
  }

  const reactivating = preset === 'onboarding'

  return (
    <Modal
      open={open}
      onClose={close}
      title={reactivating ? 'Reactivate person' : 'Change status'}
      description={`${personName(person)} is ${statusLabel(person.status).toLowerCase()} now.`}
      closeOnBackdrop={!change.isPending}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={change.isPending}>Cancel</Button>
          <Button type="submit" loading={change.isPending}>{reactivating ? 'Reactivate' : 'Change status'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {reactivating ? (
          <Alert tone="info">They come back as onboarding, on the same record. Nothing is lost and they keep their employee code.</Alert>
        ) : (
          <Select
            label="New status" required value={status} placeholder="Choose a status"
            onChange={e => { setStatus(e.target.value as PersonStatus); setError('') }}
            options={STATUS_OPTIONS.filter(o => o.value !== person.status && o.value !== 'onboarding')}
            hint={status ? CONSEQUENCE[status] : undefined}
          />
        )}
        {status === 'on_leave' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="First day of leave" type="date" required value={from} onChange={e => setFrom(e.target.value)} />
            <Input label="Last day of leave" type="date" required value={until} onChange={e => setUntil(e.target.value)} min={from || undefined} />
          </div>
        )}
        {status === 'suspended' && (
          <Input label="Suspended until" type="date" value={until} onChange={e => setUntil(e.target.value)}
            hint="Optional. They become active again on this date and staff are told. Leave blank to suspend with no end date." />
        )}
        {status && (
          <Textarea
            label={NEEDS_REASON.includes(status) ? 'Reason' : 'Note'} required={NEEDS_REASON.includes(status)}
            rows={3} value={reason} onChange={e => setReason(e.target.value)}
            hint="Kept in their history with your name."
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  )
}
