import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Mail, Pencil, RotateCcw, ShieldAlert, UserCog } from 'lucide-react'
import { peopleAPI, usersAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import {
  Alert, Button, buttonClasses, Card, DetailList, EmptyState, ErrorState, Modal, Page, PageHeader, Select, Skeleton, StatusPill, Tabs, TabPanel,
  useConfirm, useTabParam, type TabItem,
} from '@/components/ui'
import { isNotFoundError, errorMessage, formatDateTime } from '@/utils/display'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { StatusModal } from '@/components/people/StatusModal'
import { EditProfileModal } from '@/components/people/EditProfileModal'
import { PhoneModal } from '@/components/people/PhoneModal'
import { DocumentsTab } from '@/components/people/DocumentsTab'
import { BankTab } from '@/components/people/BankTab'
import { ContactsTab } from '@/components/people/ContactsTab'
import { ActivityTab, NotesTab } from '@/components/people/HistoryTabs'
import { OverviewTab, PerformanceTab } from '@/components/people/OverviewTab'
import { completeness, liveDocuments } from '@/components/people/docs'
import { STATUS_TONES, STAFF_ROLES, personName, roleLabel, statusLabel, type PersonDetail, type PersonStatus } from '@/components/people/types'

const TAB_IDS = ['overview', 'documents', 'bank', 'contacts', 'activity', 'notes', 'performance'] as const
type TabId = typeof TAB_IDS[number]


export default function PersonPage() {
  const { id = '' } = useParams()
  const detail = useQuery({
    queryKey: ['people', 'detail', id],
    queryFn: () => peopleAPI.get(id),
    enabled: !!id,
    retry: (count, err) => !isNotFoundError(err) && count < 2,
  })

  if (detail.isLoading) {
    return (
      <Page>
        <PageHeader title="Person" back={{ to: '/admin/users', label: 'People' }} />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </Page>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <PageHeader title="Person" back={{ to: '/admin/users', label: 'People' }} />
        {isNotFoundError(detail.error) ? (
          <EmptyState
            title="No person profile here"
            description="This account may be a vendor or 3PL partner, whose details are reviewed under KYC review, or it no longer exists."
            action={<Link to="/admin/kyc" className={buttonClasses({ variant: 'secondary' })}>Open KYC review</Link>}
          />
        ) : (
          <ErrorState title="We could not load this profile" description="Check your connection and try again." onRetry={() => detail.refetch()} />
        )}
      </Page>
    )
  }
  return <PersonView detail={detail.data} />
}

function PersonView({ detail }: { detail: PersonDetail }) {
  const { user, profile, documents } = detail
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const myRole = useAuthStore(s => s.role)
  const myId = useAuthStore(s => s.userId)
  const canAdmin = myRole === 'admin' || myRole === 'superadmin'
  const isSuper = myRole === 'superadmin'
  const isSelf = user.id === myId
  const isDriver = user.role === 'driver'
  const partnerDriver = isDriver && profile?.employer_type === 'partner'
  const [editOpen, setEditOpen] = useState(false)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState<'change' | 'reactivate' | null>(null)
  const [roleOpen, setRoleOpen] = useState(false)

  const allowed: TabId[] = useMemo(() => [
    'overview', 'documents', ...(canAdmin && !partnerDriver ? ['bank' as const] : []), 'contacts', 'activity', 'notes', ...(isDriver ? ['performance' as const] : []),
  ], [canAdmin, partnerDriver, isDriver])
  const [tabParam, setTab] = useTabParam<TabId>(TAB_IDS, 'overview')
  const tab = allowed.includes(tabParam) ? tabParam : 'overview'

  // Vendors and 3PL partners keep their KYC flow.
  const isStaffOrDriver = STAFF_ROLES.includes(user.role) || isDriver

  const photoDoc = liveDocuments(documents).find(d => d.doc_type === 'photo' && d.file_path)
  const photo = useQuery({
    queryKey: ['people', 'photo', user.id, photoDoc?.id],
    queryFn: () => peopleAPI.documentFile(user.id, photoDoc!.id),
    enabled: !!photoDoc,
    staleTime: 5 * 60_000,
  })

  const done = completeness(user.role, documents, profile?.no_pan_reason)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['people'] })

  const invite = useMutation({
    mutationFn: () => peopleAPI.resendInvite(user.id),
    onSuccess: () => { toast.success('Invite sent'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not send the invite. You can resend one every 10 minutes.')),
  })
  const anonymise = useMutation({
    mutationFn: () => peopleAPI.anonymise(user.id),
    onSuccess: () => { toast.success('Personal data removed'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not anonymise this person. Try again.')),
  })

  const askAnonymise = async () => {
    const ok = await confirm({
      title: `Anonymise ${personName(user)}?`,
      message: 'This removes their name, contact details, documents, bank details and emergency contacts for good. Trips, shipments and invoices keep working. This cannot be undone.',
      confirmLabel: 'Continue', tone: 'danger',
    })
    if (!ok) return
    const typed = await prompt({
      title: 'Type ANONYMISE to confirm',
      message: `Nothing can bring back ${personName(user)}'s personal data afterwards.`,
      inputLabel: 'Confirmation', required: true, confirmLabel: 'Anonymise person', tone: 'danger',
    })
    if (typed?.trim() === 'ANONYMISE') anonymise.mutate()
    else if (typed) toast.error('That did not match, so nothing was removed')
  }

  const canChangeStatus = canAdmin && !isSelf && (user.role !== 'superadmin' || isSuper)
  const canChangeRole = isSuper && !isSelf && !isDriver && STAFF_ROLES.includes(user.role)
  const noAccount = user.has_sign_in_account === false
  const inviteSent = profile?.invite_sent_at

  const tabs: TabItem<TabId>[] = allowed.map(t => ({
    id: t,
    label: { overview: 'Overview', documents: 'Documents', bank: 'Bank and payout', contacts: 'Emergency contacts', activity: 'Activity', notes: 'Notes', performance: 'Performance' }[t],
  }))

  const pct = done.required > 0 ? Math.round((done.verified / done.required) * 100) : 0

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <PersonAvatar name={user.full_name} url={photo.data?.url} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{personName(user)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal text-muted">
                {roleLabel(user.role)}
                <StatusPill tone={STATUS_TONES[user.status as PersonStatus] ?? 'neutral'}>{statusLabel(user.status)}</StatusPill>
                {partnerDriver && <StatusPill tone="info" dot={false}>{profile?.employer_partner_name ?? '3PL partner'}</StatusPill>}
                {isSelf && <span>(you)</span>}
              </span>
            </span>
          </span>
        }
        back={{ to: '/admin/users', label: 'People' }}
        actions={
          isStaffOrDriver && (
            <div className="flex flex-wrap gap-2">
              {canAdmin && <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditOpen(true)}>Edit profile</Button>}
              {canChangeStatus && user.status === 'inactive' && <Button icon={<RotateCcw size={16} />} onClick={() => setStatusOpen('reactivate')}>Reactivate</Button>}
              {canChangeStatus && user.status !== 'inactive' && <Button variant="secondary" onClick={() => setStatusOpen('change')}>Change status</Button>}
              {canChangeRole && <Button variant="secondary" icon={<UserCog size={16} />} onClick={() => setRoleOpen(true)}>Change role</Button>}
              {isSuper && user.status === 'inactive' && !profile?.anonymised_at && !isSelf && (
                <Button variant="danger" icon={<ShieldAlert size={16} />} loading={anonymise.isPending} onClick={askAnonymise}>Anonymise</Button>
              )}
            </div>
          )
        }
      />

      {!isStaffOrDriver ? (
        <Card padded className="space-y-3">
          <DetailList columns={2} items={[
            { label: 'Role', value: roleLabel(user.role) },
            { label: 'Email', value: user.email ?? 'Not set' },
            { label: 'Phone', value: user.phone ?? 'Not set' },
            { label: 'Status', value: statusLabel(user.status) },
          ]} />
          <p className="text-sm text-muted">Vendors and 3PL partners are reviewed with their company and KYC details.</p>
          <Link to="/admin/kyc" className={buttonClasses({ variant: 'secondary' })}>Open KYC review</Link>
        </Card>
      ) : (
        <>
          {profile?.anonymised_at && <Alert tone="info">Personal data for this person was removed on {formatDateTime(profile.anonymised_at)}.</Alert>}
          {noAccount && (
            <Alert
              tone="warning"
              title="No sign-in account"
              action={!isDriver && canAdmin && <Button size="sm" icon={<Mail size={16} />} loading={invite.isPending} onClick={() => invite.mutate()}>Send invite</Button>}
            >
              {isDriver
                ? `They have no sign-in yet. The driver signs in with a one-time code sent to ${user.phone ?? 'their mobile number'} and lands on this record.`
                : 'Their sign-in was removed. Send an invite to the work email and the new account links to this same record.'}
            </Alert>
          )}
          {!noAccount && !isDriver && user.status === 'onboarding' && inviteSent && (
            <Alert
              tone="info"
              title={`Invite sent on ${formatDateTime(inviteSent)}`}
              action={canAdmin && <Button size="sm" variant="secondary" icon={<Mail size={16} />} loading={invite.isPending} onClick={() => invite.mutate()}>Resend invite</Button>}
            >
              They have not accepted it yet. You can resend one every 10 minutes.
            </Alert>
          )}

          {done.required > 0 && (
            <Card padded className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-text">Documents {done.verified} of {done.required} verified</p>
                {done.verified < done.required && canAdmin && tab !== 'documents' && (
                  <Button variant="ghost" size="sm" onClick={() => setTab('documents')}>Go to documents</Button>
                )}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={done.required} aria-valuenow={done.verified} aria-label="Required documents verified">
                <div className={done.verified === done.required ? 'h-full bg-success' : 'h-full bg-warning'} style={{ width: `${pct}%` }} />
              </div>
            </Card>
          )}

          <Tabs label="Person sections" tabs={tabs} value={tab} onChange={setTab} />
          <TabPanel id={tab}>
            {tab === 'overview' && <OverviewTab detail={detail} canEdit={canAdmin} onEdit={() => setEditOpen(true)} onChangePhone={() => setPhoneOpen(true)} />}
            {tab === 'documents' && <DocumentsTab detail={detail} canEdit canAdmin={canAdmin} />}
            {tab === 'bank' && <BankTab detail={detail} canReveal={isSuper} />}
            {tab === 'contacts' && <ContactsTab detail={detail} />}
            {tab === 'activity' && <ActivityTab detail={detail} />}
            {tab === 'notes' && <NotesTab detail={detail} />}
            {tab === 'performance' && <PerformanceTab detail={detail} />}
          </TabPanel>

          <EditProfileModal detail={detail} open={editOpen} onClose={() => setEditOpen(false)} />
          <PhoneModal detail={detail} open={phoneOpen} onClose={() => setPhoneOpen(false)} />
          <StatusModal person={user} open={statusOpen !== null} preset={statusOpen === 'reactivate' ? 'onboarding' : undefined} onClose={() => setStatusOpen(null)} />
          <RoleModal detail={detail} open={roleOpen} onClose={() => setRoleOpen(false)} />
        </>
      )}
    </Page>
  )
}

/** Superadmin only. A driver cannot become staff (or the reverse): they sign in differently. */
function RoleModal({ detail, open, onClose }: { detail: PersonDetail; open: boolean; onClose: () => void }) {
  const { user } = detail
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [role, setRole] = useState('')
  const change = useMutation({
    mutationFn: (r: string) => usersAPI.update(user.id, { role: r }),
    onSuccess: () => { toast.success('Role changed'); queryClient.invalidateQueries({ queryKey: ['people'] }); onClose() },
    onError: err => toast.error(errorMessage(err, 'We could not change the role. Try again.')),
  })
  const submit = async () => {
    if (!role) return
    const ok = await confirm({
      title: `Make ${personName(user)} ${roleLabel(role).toLowerCase()}?`,
      message: role === 'superadmin' || role === 'admin'
        ? `They will be able to see and change everything ${role === 'admin' ? 'an admin' : 'a superadmin'} can, including other people. This is logged.`
        : 'Their access changes the next time they load the app. This is logged.',
      confirmLabel: 'Change role', tone: role === 'manager' ? 'primary' : 'danger',
    })
    if (ok) change.mutate(role)
  }
  return (
    <Modal open={open} onClose={onClose} title="Change role" description={`${personName(user)} is ${roleLabel(user.role).toLowerCase()} now.`} onSubmit={submit}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={change.isPending} disabled={!role}>Change role</Button></>}>
      <Select label="New role" value={role} onChange={e => setRole(e.target.value)} placeholder="Choose a role"
        options={['manager', 'admin', 'superadmin'].filter(r => r !== user.role).map(r => ({ value: r, label: roleLabel(r) }))}
        hint="Only a superadmin can do this. To make a driver a staff member, add them as a new person: they sign in differently." />
    </Modal>
  )
}
