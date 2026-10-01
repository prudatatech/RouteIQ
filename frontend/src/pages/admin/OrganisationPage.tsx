import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { orgAPI } from '@/services/api'
import {
  Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Input, Modal, Page, PageHeader, Select, Skeleton,
  StatusPill, Textarea, type Column,
} from '@/components/ui'
import { errorMessage, serverFieldError } from '@/utils/display'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import {
  canManageOrg, ORG_ROLE_LABELS, type OrgMember, type OrgProfileInput, type OrgRole,
} from '@/utils/orgs'

const ROLE_OPTIONS = (Object.keys(ORG_ROLE_LABELS) as OrgRole[]).map(r => ({ value: r, label: ORG_ROLE_LABELS[r] }))

const EMPTY_PROFILE: OrgProfileInput = { name: '', legal_name: '', gstin: '', pan: '', state: '', address: '' }

function ProfileCard({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['org', orgId], queryFn: () => orgAPI.get() })
  const [form, setForm] = useState<OrgProfileInput>(EMPTY_PROFILE)
  const [errors, setErrors] = useState<Partial<Record<keyof OrgProfileInput, string>>>({})
  const [formError, setFormError] = useState<string | undefined>()

  useEffect(() => {
    const p = profile.data
    if (p) setForm({ name: p.name ?? '', legal_name: p.legal_name ?? '', gstin: p.gstin ?? '', pan: p.pan ?? '', state: p.state ?? '', address: p.address ?? '' })
  }, [profile.data])

  const save = useMutation({
    mutationFn: () => orgAPI.update(form),
    onSuccess: data => {
      toast.success('Organisation saved')
      queryClient.setQueryData(['org', orgId], data)
      // The header shows the name
      useOrgStore.getState().setMemberships(
        useOrgStore.getState().memberships.map(m => (m.org.id === orgId ? { ...m, org: { ...m.org, name: data.name ?? m.org.name } } : m)),
      )
    },
    onError: err => {
      const named = serverFieldError(err)
      if (named && named.field in EMPTY_PROFILE) setErrors({ [named.field]: named.message })
      else setFormError(errorMessage(err, 'We could not save the organisation. Try again.'))
    },
  })

  const set = (key: keyof OrgProfileInput) => (value: string) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => ({ ...e, [key]: undefined }))
    setFormError(undefined)
  }

  return (
    <Card>
      <CardHeader title="Profile" description="How this organisation appears on invoices and documents." />
      <CardBody>
        {profile.isLoading ? <Skeleton className="h-40 w-full" /> : profile.isError ? (
          <ErrorState title="We could not load the organisation" onRetry={() => profile.refetch()} />
        ) : (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={e => {
              e.preventDefault()
              if (!form.name.trim()) { setErrors({ name: 'Enter the name' }); return }
              setErrors({})
              save.mutate()
            }}
          >
            <Input label="Name" required value={form.name} error={errors.name} onChange={e => set('name')(e.target.value)} />
            <Input label="Legal name" value={form.legal_name} error={errors.legal_name} onChange={e => set('legal_name')(e.target.value)} />
            <Input label="GSTIN" value={form.gstin} error={errors.gstin} onChange={e => set('gstin')(e.target.value.toUpperCase())} />
            <Input label="PAN" value={form.pan} error={errors.pan} onChange={e => set('pan')(e.target.value.toUpperCase())} />
            <Input label="State" value={form.state} error={errors.state} onChange={e => set('state')(e.target.value)} />
            <Textarea label="Address" className="sm:col-span-2" value={form.address} error={errors.address} onChange={e => set('address')(e.target.value)} />
            {formError && <p role="alert" className="text-sm text-danger sm:col-span-2">{formError}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" loading={save.isPending}>Save</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  )
}

function MemberModal({ open, onClose, member, orgId }: { open: boolean; onClose: () => void; member: OrgMember | null; orgId: string }) {
  const queryClient = useQueryClient()
  const [contact, setContact] = useState('')
  const [role, setRole] = useState<OrgRole>('member')
  const [error, setError] = useState<string | undefined>()
  const editing = member !== null

  useEffect(() => {
    if (open) { setContact(''); setRole(member?.role ?? 'member'); setError(undefined) }
  }, [open, member])

  const save = useMutation({
    mutationFn: () => {
      if (member) return orgAPI.updateMember(member.user_id, { role })
      const value = contact.trim()
      return orgAPI.addMember({ ...(value.includes('@') ? { email: value } : { phone: value }), role })
    },
    onSuccess: () => {
      toast.success(editing ? 'Role changed' : 'Member added')
      void queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
      onClose()
    },
    onError: err => setError(errorMessage(err, 'We could not save this member. Try again.')),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Change role' : 'Add member'}
      description={editing ? (member.name || member.email || member.phone || undefined) : 'Add a person by email or phone. They must already have an account.'}
      onSubmit={() => {
        if (!editing && !contact.trim()) { setError('Enter an email or phone'); return }
        setError(undefined)
        save.mutate()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{editing ? 'Save' : 'Add'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!editing && <Input label="Email or phone" required value={contact} onChange={e => { setContact(e.target.value); setError(undefined) }} />}
        <Select label="Role" value={role} options={ROLE_OPTIONS} onChange={e => setRole(e.target.value as OrgRole)} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}

function MembersCard({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient()
  const members = useQuery({ queryKey: ['org-members', orgId], queryFn: () => orgAPI.members() })
  const [modal, setModal] = useState<{ member: OrgMember | null } | null>(null)

  const toggle = useMutation({
    mutationFn: (m: OrgMember) => orgAPI.updateMember(m.user_id, { status: m.status === 'active' ? 'removed' : 'active' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['org-members', orgId] }),
    onError: err => toast.error(errorMessage(err, 'We could not change this member. Try again.')),
  })

  const columns: Column<OrgMember>[] = [
    {
      key: 'person', header: 'Person', sortValue: m => m.name || m.email || m.phone,
      cell: m => (
        <div className="min-w-0">
          <div className="truncate font-medium">{m.name || m.email || m.phone || m.user_id}</div>
          {m.name && <div className="truncate text-xs text-muted">{m.email || m.phone}</div>}
        </div>
      ),
    },
    { key: 'role', header: 'Role', sortValue: m => m.role, cell: m => ORG_ROLE_LABELS[m.role] ?? m.role },
    { key: 'status', header: 'Status', sortValue: m => m.status, cell: m => <StatusPill status={m.status} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: m => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setModal({ member: m })}>Change role</Button>
          <Button size="sm" variant="secondary" loading={toggle.isPending && toggle.variables?.user_id === m.user_id} onClick={() => toggle.mutate(m)}>
            {m.status === 'active' ? 'Remove' : 'Restore'}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader title="Members" description="People who work in this organisation and what they can do." actions={<Button onClick={() => setModal({ member: null })}>Add member</Button>} />
      <CardBody>
        <DataTable
          caption="Members of this organisation"
          columns={columns}
          rows={members.data ?? []}
          rowKey={m => m.user_id}
          loading={members.isLoading}
          error={members.isError ? errorMessage(members.error, 'We could not load the members.') : undefined}
          onRetry={() => members.refetch()}
          empty={{ title: 'No members yet', description: 'Add the first person to this organisation.' }}
        />
      </CardBody>
      <MemberModal open={modal !== null} member={modal?.member ?? null} orgId={orgId} onClose={() => setModal(null)} />
    </Card>
  )
}

/** The active organisation's profile and members, for its owners and admins. */
export default function OrganisationPage() {
  const loaded = useOrgStore(s => s.loaded)
  const active = useOrgStore(selectActiveMembership)

  return (
    <Page>
      <PageHeader title="Organisation" description={active ? active.org.name : undefined} />
      {!loaded ? <Skeleton className="h-40 w-full" /> : !active ? (
        <EmptyState title="No organisation yet" description="Organisations are not set up for your account." />
      ) : !canManageOrg(active.role) ? (
        <EmptyState title="Owners and admins only" description="Ask an owner or admin of this organisation to change its profile or members." />
      ) : (
        <div className="flex flex-col gap-6">
          <ProfileCard orgId={active.org.id} />
          <MembersCard orgId={active.org.id} />
        </div>
      )}
    </Page>
  )
}
