import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { UserPlus, Users } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, StatusPill } from '@/components/ui'
import { tplPortalAPI } from '@/services/api'
import { errorMessage } from '@/utils/display'
import { indianMobileError } from '@/utils/validators'
import { usePortal } from './portalContext'

/** Drivers: the people who drive for this partner. A driver is invited by phone and signs in to the driver app with an OTP. */
export default function DriversPage() {
  const { partner } = usePortal()
  const queryClient = useQueryClient()
  const [inviting, setInviting] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const key = ['tpl-portal-drivers', partner.id]
  const drivers = useQuery({ queryKey: key, queryFn: () => tplPortalAPI.drivers(partner.id) })

  const nameError = submitted && !name.trim() ? 'Enter the driver’s name' : undefined
  const phoneError = submitted ? (phone.trim() ? indianMobileError(phone) : 'Enter the driver’s mobile number') : undefined

  const close = () => { setInviting(false); setName(''); setPhone(''); setSubmitted(false) }
  const invite = useMutation({
    mutationFn: () => tplPortalAPI.inviteDriver(partner.id, { name: name.trim(), phone: phone.trim() }),
    onSuccess: () => { toast.success('Invite sent. The driver signs in with a code sent to this phone.'); queryClient.invalidateQueries({ queryKey: key }); close() },
    onError: err => toast.error(errorMessage(err, 'We could not invite this driver. Try again.')),
  })
  const submit = () => {
    setSubmitted(true)
    if (!name.trim() || !phone.trim() || indianMobileError(phone)) return
    invite.mutate()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drivers"
        description="Invite the drivers who run your trips. They get the loads you accept in their driver app."
        actions={<Button icon={<UserPlus size={16} />} onClick={() => setInviting(true)}>Invite by phone</Button>}
      />
      {drivers.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : drivers.error ? (
        <ErrorState description="We could not load your drivers." onRetry={() => drivers.refetch()} />
      ) : (drivers.data ?? []).length === 0 ? (
        <Card padded>
          <EmptyState compact icon={<Users size={22} />} title="No drivers yet" description="Invite a driver by phone number. You pick a driver when you accept a load." />
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-control border border-border bg-surface">
          {(drivers.data ?? []).map(d => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{d.full_name ?? 'Driver'}</p>
                <p className="text-xs text-muted">{d.phone ?? 'No phone'}</p>
              </div>
              {d.status && <StatusPill status={d.status} />}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={inviting}
        onClose={close}
        onSubmit={submit}
        title="Invite a driver"
        description="We send a sign-in code to this phone."
        footer={(
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" loading={invite.isPending}>Send invite</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Input label="Name" required value={name} onChange={e => setName(e.target.value)} error={nameError} />
          <Input label="Mobile number" required inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} error={phoneError} />
        </div>
      </Modal>
    </div>
  )
}
