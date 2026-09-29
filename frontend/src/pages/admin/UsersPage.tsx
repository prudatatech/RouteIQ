import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { UserPlus } from 'lucide-react'
import { usersAPI, authAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import {
  Button, DataTable, Input, Modal, Page, PageHeader, SearchInput, Select, StatusPill, Tabs, TabPanel,
  parseSort, serializeSort, useConfirm, useTabParam, useUrlState, type Column,
} from '@/components/ui'
import { errorMessage, formatDate } from '@/utils/display'

interface VendorProfileSummary {
  company_name: string | null
  city: string | null
  gst_number: string | null
}

interface User {
  id: string
  email: string | null
  full_name: string | null
  role: string
  is_active: boolean
  created_at: string
  vendor_profiles: VendorProfileSummary[] | null
}

/** Roles staff can hand out here. Drivers are created from the driver app, so their role is fixed. */
const ROLE_OPTIONS = [
  { value: 'superadmin', label: 'Superadmin' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'vendor', label: 'Vendor' },
]
const roleLabel = (role: string) => ROLE_OPTIONS.find(r => r.value === role)?.label ?? (role === 'driver' ? 'Driver' : role)

/** Placeholder the backend returns for vendors that signed up without a user row. */
const NO_EMAIL = '(Vendor Signup)'
/** Company name vendor accounts get before they finish setup. */
const PLACEHOLDER_COMPANY = 'New Vendor (Pending Setup)'

const TAB_IDS = ['all', 'staff', 'vendors', 'drivers', 'inactive'] as const
type TabId = typeof TAB_IDS[number]
const STAFF_ROLES = ['superadmin', 'admin', 'manager']

function displayName(u: User) {
  const company = u.vendor_profiles?.[0]?.company_name
  if (u.role === 'vendor' && company && company !== PLACEHOLDER_COMPANY) return company
  return u.full_name || emailOf(u) || 'Unnamed user'
}
/** City and GST, skipping the placeholders a new vendor account starts with. */
function vendorMeta(vp: VendorProfileSummary) {
  const city = vp.city && vp.city !== 'Pending' ? vp.city : null
  const gst = vp.gst_number && vp.gst_number !== 'PENDING' ? `GST ${vp.gst_number}` : null
  return [city, gst].filter(Boolean).join(' · ')
}
const emailOf = (u: User) => (u.email && u.email !== NO_EMAIL ? u.email : null)

function inTab(u: User, t: TabId) {
  switch (t) {
    case 'staff': return STAFF_ROLES.includes(u.role)
    case 'vendors': return u.role === 'vendor'
    case 'drivers': return u.role === 'driver'
    case 'inactive': return !u.is_active
    default: return true
  }
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const currentUserId = useAuthStore(s => s.userId)
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'all')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort', { fallback: 'joined:desc' })
  const sort = parseSort(sortParam)
  const [inviteOpen, setInviteOpen] = useState(false)

  const users = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const d = await usersAPI.list(); return Array.isArray(d) ? d : [] },
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; is_active?: boolean } }) => usersAPI.update(id, data),
    onSuccess: (_d, { data }) => toast.success(data.role ? 'Role updated' : data.is_active ? 'User reactivated' : 'User deactivated'),
    onError: err => toast.error(errorMessage(err, 'We could not update this user. Try again.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const all = useMemo(() => users.data ?? [], [users.data])
  const counts = useMemo(() => Object.fromEntries(TAB_IDS.map(t => [t, all.filter(u => inTab(u, t)).length])) as Record<TabId, number>, [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(u => inTab(u, tab) && (!q || [displayName(u), u.email, u.full_name, u.vendor_profiles?.[0]?.company_name]
      .some(v => (v ?? '').toLowerCase().includes(q))))
  }, [all, tab, search])

  const changeRole = async (u: User, role: string) => {
    if (role === u.role) return
    const ok = await confirm({
      title: `Make ${displayName(u)} ${roleLabel(role).toLowerCase()}?`,
      message: role === 'superadmin' || role === 'admin'
        ? `They will be able to see and change everything a${role === 'admin' ? 'n admin' : ' superadmin'} can, including other users.`
        : `Their access changes to what a ${roleLabel(role).toLowerCase()} can do the next time they load the app.`,
      confirmLabel: 'Change role',
      tone: role === 'superadmin' || role === 'admin' ? 'danger' : 'primary',
    })
    if (ok) update.mutate({ id: u.id, data: { role } })
  }

  const toggleActive = async (u: User) => {
    const deactivate = u.is_active
    const ok = await confirm({
      title: deactivate ? `Deactivate ${displayName(u)}?` : `Reactivate ${displayName(u)}?`,
      message: deactivate
        ? 'They will no longer be able to use MargixIndia. You can reactivate them later.'
        : 'They will be able to sign in and use MargixIndia again.',
      confirmLabel: deactivate ? 'Deactivate user' : 'Reactivate user',
      tone: deactivate ? 'danger' : 'primary',
    })
    if (ok) update.mutate({ id: u.id, data: { is_active: !u.is_active } })
  }

  const busyId = update.isPending ? update.variables?.id : null

  const columns: Column<User>[] = [
    {
      key: 'name', header: 'User',
      sortValue: u => displayName(u).toLowerCase(),
      cell: u => {
        const vp = u.vendor_profiles?.[0]
        return (
          <div className="min-w-0">
            <p className="font-medium text-text">
              {displayName(u)}
              {u.id === currentUserId && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
            </p>
            <p className="truncate text-xs text-muted">{emailOf(u) ?? 'No sign-in email on file'}</p>
            {u.role === 'vendor' && vp && vendorMeta(vp) && <p className="truncate text-xs text-muted">{vendorMeta(vp)}</p>}
          </div>
        )
      },
    },
    {
      key: 'role', header: 'Role', width: 'w-44',
      sortValue: u => roleLabel(u.role),
      cell: u => (u.role === 'driver' || u.id === currentUserId) ? (
        <span className="text-sm text-text" title={u.role === 'driver' ? 'Driver roles are managed from the driver app' : 'You cannot change your own role'}>
          {roleLabel(u.role)}
        </span>
      ) : (
        <Select
          label={`Role for ${displayName(u)}`}
          hideLabel
          value={u.role}
          options={ROLE_OPTIONS}
          disabled={busyId === u.id}
          onChange={e => changeRole(u, e.target.value)}
          onClick={e => e.stopPropagation()}
        />
      ),
    },
    {
      key: 'status', header: 'Status',
      sortValue: u => (u.is_active ? 0 : 1),
      cell: u => <StatusPill tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Active' : 'Deactivated'}</StatusPill>,
    },
    {
      key: 'joined', header: 'Joined', hideBelow: 'lg',
      sortValue: u => new Date(u.created_at).getTime(),
      cell: u => formatDate(u.created_at),
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: u => u.id === currentUserId ? null : (
        <Button
          size="sm"
          variant={u.is_active ? 'secondary' : 'primary'}
          loading={busyId === u.id && update.variables?.data.is_active !== undefined}
          disabled={busyId === u.id}
          onClick={() => toggleActive(u)}
        >
          {u.is_active ? 'Deactivate' : 'Reactivate'}
        </Button>
      ),
    },
  ]

  const tabs = [
    { id: 'all' as const, label: 'All', count: counts.all },
    { id: 'staff' as const, label: 'Staff', count: counts.staff },
    { id: 'vendors' as const, label: 'Vendors', count: counts.vendors },
    { id: 'drivers' as const, label: 'Drivers', count: counts.drivers },
    { id: 'inactive' as const, label: 'Deactivated', count: counts.inactive },
  ]

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Everyone who can sign in to MargixIndia, and what they can do."
        actions={<Button icon={<UserPlus size={16} />} onClick={() => setInviteOpen(true)}>Add vendor</Button>}
      >
        <div className="space-y-4">
          <Tabs label="Filter users" tabs={users.isLoading ? tabs.map(t => ({ ...t, count: undefined })) : tabs} value={tab} onChange={setTab} />
          <SearchInput value={search} onChange={setSearch} label="Search users" placeholder="Search by name, email or company" className="max-w-sm" />
        </div>
      </PageHeader>

      <TabPanel id={tab}>
        <DataTable
          caption="Users"
          columns={columns}
          rows={rows}
          rowKey={u => u.id}
          loading={users.isLoading}
          error={users.error ? 'We could not load users. Check your connection and try again.' : undefined}
          onRetry={() => users.refetch()}
          sort={sort}
          onSortChange={s => setSortParam(serializeSort(s))}
          empty={search
            ? { title: 'No users match your search', action: <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> }
            : { title: 'No users here' }}
        />
      </TabPanel>

      <AddVendorModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </Page>
  )
}

function AddVendorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const close = () => { setEmail(''); setPassword(''); onClose() }

  const invite = useMutation({
    mutationFn: () => authAPI.inviteVendor(email.trim(), password),
    onSuccess: () => {
      toast.success('Vendor account created. Share the sign-in details with them securely.')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      close()
    },
    onError: err => toast.error(errorMessage(err, 'We could not create the vendor account. Try again.')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (email.trim() && password.length >= 6) invite.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add vendor"
      description="Creates a vendor account. The vendor signs in with these details and completes their company and KYC details."
      closeOnBackdrop={!invite.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={invite.isPending}>Cancel</Button>
          <Button type="submit" form="add-vendor-form" loading={invite.isPending} disabled={!email.trim() || password.length < 6}>Create account</Button>
        </>
      }
    >
      <form id="add-vendor-form" onSubmit={submit} className="space-y-4">
        <Input label="Email" type="email" required autoComplete="off" data-autofocus value={email} onChange={e => setEmail(e.target.value)} placeholder="vendor@company.com" />
        <Input
          label="Temporary password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          minLength={6}
          hint="At least 6 characters. Share it with the vendor securely."
        />
      </form>
    </Modal>
  )
}
