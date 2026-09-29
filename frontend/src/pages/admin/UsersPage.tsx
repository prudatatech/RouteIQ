import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Building2, UserPlus, UsersRound } from 'lucide-react'
import { usersAPI, authAPI, peopleAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import {
  Button, buttonClasses, DataTable, Input, Modal, Page, PageHeader, SearchInput, Select, StatusPill, Tabs, TabPanel,
  parseSort, serializeSort, useConfirm, useTabParam, useUrlState, type Column,
} from '@/components/ui'
import { errorMessage, formatDate, formatRelative } from '@/utils/display'
import { AddPersonModal } from '@/components/people/AddPersonModal'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { docSummaryView, needsAttention } from '@/components/people/docs'
import {
  ROLE_LABELS, STAFF_ROLES, STATUS_OPTIONS, STATUS_TONES, personName, roleLabel, statusLabel, type PersonRow,
} from '@/components/people/types'

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

const VENDOR_ROLE_OPTIONS = [
  { value: 'superadmin', label: 'Superadmin' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'vendor', label: 'Vendor' },
]

/** Placeholder the backend returns for vendors that signed up without a user row. */
const NO_EMAIL = '(Vendor Signup)'
/** Company name vendor accounts get before they finish setup. */
const PLACEHOLDER_COMPANY = 'New Vendor (Pending Setup)'

const TAB_IDS = ['all', 'drivers', 'staff', 'attention', 'vendors'] as const
type TabId = typeof TAB_IDS[number]

const ROLE_FILTER = [
  { value: 'driver', label: 'Driver' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'superadmin', label: 'Superadmin' },
]

function vendorName(u: User) {
  const company = u.vendor_profiles?.[0]?.company_name
  if (u.role === 'vendor' && company && company !== PLACEHOLDER_COMPANY) return company
  return u.full_name || vendorEmail(u) || 'Unnamed user'
}
/** City and GST, skipping the placeholders a new vendor account starts with. */
function vendorMeta(vp: VendorProfileSummary) {
  const city = vp.city && vp.city !== 'Pending' ? vp.city : null
  const gst = vp.gst_number && vp.gst_number !== 'PENDING' ? `GST ${vp.gst_number}` : null
  return [city, gst].filter(Boolean).join(' · ')
}
const vendorEmail = (u: User) => (u.email && u.email !== NO_EMAIL ? u.email : null)

function inTab(p: PersonRow, t: TabId) {
  switch (t) {
    case 'drivers': return p.role === 'driver'
    case 'staff': return STAFF_ROLES.includes(p.role)
    case 'attention': return needsAttention(p.doc_summary)
    default: return true
  }
}

export default function UsersPage() {
  const navigate = useNavigate()
  const myRole = useAuthStore(s => s.role)
  const canAdd = myRole === 'admin' || myRole === 'superadmin'
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'all')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [status, setStatus] = useUrlState('status')
  const [role, setRole] = useUrlState('role')
  const [sortParam, setSortParam] = useUrlState('sort', { fallback: 'name:asc' })
  const sort = parseSort(sortParam)
  const [addOpen, setAddOpen] = useState(false)
  const [vendorOpen, setVendorOpen] = useState(false)

  const people = useQuery<PersonRow[]>({
    queryKey: ['people', 'list', status, search.trim()],
    queryFn: () => peopleAPI.list({ status: status || undefined, q: search.trim() || undefined, limit: 500 }),
    enabled: tab !== 'vendors',
  })

  const all = useMemo(() => people.data ?? [], [people.data])
  const counts = useMemo(() => Object.fromEntries(TAB_IDS.map(t => [t, all.filter(p => inTab(p, t)).length])) as Record<TabId, number>, [all])
  const rows = useMemo(() => all.filter(p => inTab(p, tab) && (!role || p.role === role)), [all, tab, role])

  const columns: Column<PersonRow>[] = [
    {
      key: 'name', header: 'Name', sortValue: p => personName(p).toLowerCase(),
      cell: p => (
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={p.full_name ?? p.email} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{personName(p)}</p>
            <p className="truncate text-xs text-muted">{p.role === 'driver' ? p.phone : p.email ?? p.phone}</p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', sortValue: p => roleLabel(p.role), cell: p => roleLabel(p.role) },
    {
      key: 'code', header: 'Employee code', hideBelow: 'lg', sortValue: p => p.employee_code ?? '',
      cell: p => p.employee_code ? <span className="font-mono text-xs">{p.employee_code}</span> : <span className="text-muted">Not set</span>,
    },
    {
      key: 'status', header: 'Status', sortValue: p => p.status,
      cell: p => <StatusPill tone={STATUS_TONES[p.status] ?? 'neutral'}>{statusLabel(p.status)}</StatusPill>,
    },
    {
      key: 'docs', header: 'Documents', sortValue: p => p.doc_summary ? p.doc_summary.verified / Math.max(1, p.doc_summary.required) : -1,
      cell: p => {
        const v = docSummaryView(p.doc_summary)
        return v ? <span title={v.hint}><StatusPill tone={v.tone} dot={false}>{v.text}</StatusPill></span> : <span className="text-muted">None required</span>
      },
    },
    {
      key: 'vehicle', header: 'Vehicle', hideBelow: 'lg', sortValue: p => p.vehicle_plate ?? '',
      cell: p => p.role !== 'driver' ? <span className="text-muted">—</span>
        : p.vehicle_plate ? <span className="font-mono text-xs">{p.vehicle_plate}</span> : <span className="text-muted">No vehicle</span>,
    },
    {
      key: 'login', header: 'Last sign-in', hideBelow: 'xl', sortValue: p => p.last_login ? new Date(p.last_login).getTime() : 0,
      cell: p => p.last_login ? formatRelative(p.last_login) : <span className="text-muted">Never</span>,
    },
  ]

  const showCounts = tab !== 'vendors' && !people.isLoading
  const tabs = [
    { id: 'all' as const, label: 'All', count: showCounts ? counts.all : undefined },
    { id: 'drivers' as const, label: 'Drivers', count: showCounts ? counts.drivers : undefined },
    { id: 'staff' as const, label: 'Staff', count: showCounts ? counts.staff : undefined },
    { id: 'attention' as const, label: 'Needs attention', count: showCounts ? counts.attention : undefined },
    ...(myRole === 'superadmin' ? [{ id: 'vendors' as const, label: 'Vendors' }] : []),
  ]
  const filtered = !!(search || status || role)

  return (
    <Page>
      <PageHeader
        title="People"
        description="Drivers and staff: who they are, their documents, and how they work with us."
        actions={
          <div className="flex flex-wrap gap-2">
            {myRole === 'superadmin' && <Button variant="secondary" icon={<Building2 size={16} />} onClick={() => setVendorOpen(true)}>Add vendor</Button>}
            {canAdd && <Button icon={<UserPlus size={16} />} onClick={() => setAddOpen(true)}>Add person</Button>}
          </div>
        }
      >
        <div className="space-y-4">
          <Tabs label="Filter people" tabs={tabs} value={tab} onChange={setTab} />
          <div className="flex flex-wrap gap-3">
            <SearchInput value={search} onChange={setSearch} label="Search people" placeholder="Search by name, email, phone or code" className="w-full sm:max-w-sm" />
            {tab !== 'vendors' && (
              <>
                <Select label="Status" hideLabel value={status} onChange={e => setStatus(e.target.value)} placeholder="All statuses" options={STATUS_OPTIONS} className="w-full sm:w-44" />
                <Select label="Role" hideLabel value={role} onChange={e => setRole(e.target.value)} placeholder="All roles" options={ROLE_FILTER} className="w-full sm:w-44" />
              </>
            )}
          </div>
        </div>
      </PageHeader>

      <TabPanel id={tab}>
        {tab === 'vendors' ? (
          <VendorsTable search={search} />
        ) : (
          <DataTable
            caption="People"
            columns={columns}
            rows={rows}
            rowKey={p => p.id}
            loading={people.isLoading}
            error={people.error ? 'We could not load people. Check your connection and try again.' : undefined}
            onRetry={() => people.refetch()}
            sort={sort}
            onSortChange={s => setSortParam(serializeSort(s))}
            onRowClick={p => navigate(`/admin/users/${p.id}`)}
            empty={filtered
              ? { title: 'No one matches these filters', action: <Button variant="secondary" onClick={() => { setSearch(''); setStatus(''); setRole('') }}>Clear filters</Button> }
              : tab === 'attention'
                ? { icon: <UsersRound size={22} />, title: 'Everyone is up to date', description: 'No one has missing, expiring or expired documents.' }
                : { icon: <UsersRound size={22} />, title: 'No people yet', description: 'Add your first driver or staff member.', action: canAdd ? <Button onClick={() => setAddOpen(true)}>Add person</Button> : undefined }}
          />
        )}
      </TabPanel>

      <AddPersonModal open={addOpen} onClose={() => setAddOpen(false)} />
      <AddVendorModal open={vendorOpen} onClose={() => setVendorOpen(false)} />
    </Page>
  )
}

/** Vendors and partners keep their KYC flow: each row links to the KYC review. */
function VendorsTable({ search }: { search: string }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const currentUserId = useAuthStore(s => s.userId)
  const myRole = useAuthStore(s => s.role)
  const users = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const d = await usersAPI.list(); return Array.isArray(d) ? d : [] },
    enabled: myRole === 'superadmin',
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; is_active?: boolean } }) => usersAPI.update(id, data),
    onSuccess: (_d, { data }) => toast.success(data.role ? 'Role updated' : data.is_active ? 'User reactivated' : 'User deactivated'),
    onError: err => toast.error(errorMessage(err, 'We could not update this user. Try again.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (users.data ?? []).filter(u => u.role === 'vendor' && (!q || [vendorName(u), u.email, u.full_name, u.vendor_profiles?.[0]?.company_name]
      .some(v => (v ?? '').toLowerCase().includes(q))))
  }, [users.data, search])

  const changeRole = async (u: User, role: string) => {
    if (role === u.role) return
    const label = (ROLE_LABELS[role] ?? role).toLowerCase()
    const ok = await confirm({
      title: `Make ${vendorName(u)} ${label}?`,
      message: role === 'superadmin' || role === 'admin'
        ? `They will be able to see and change everything a${role === 'admin' ? 'n admin' : ' superadmin'} can, including other users.`
        : `Their access changes to what a ${label} can do the next time they load the app.`,
      confirmLabel: 'Change role',
      tone: role === 'superadmin' || role === 'admin' ? 'danger' : 'primary',
    })
    if (ok) update.mutate({ id: u.id, data: { role } })
  }

  const toggleActive = async (u: User) => {
    const deactivate = u.is_active
    const ok = await confirm({
      title: deactivate ? `Deactivate ${vendorName(u)}?` : `Reactivate ${vendorName(u)}?`,
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
      key: 'name', header: 'Vendor', sortValue: u => vendorName(u).toLowerCase(),
      cell: u => {
        const vp = u.vendor_profiles?.[0]
        return (
          <div className="min-w-0">
            <p className="font-medium text-text">{vendorName(u)}</p>
            <p className="truncate text-xs text-muted">{vendorEmail(u) ?? 'No sign-in email on file'}</p>
            {vp && vendorMeta(vp) && <p className="truncate text-xs text-muted">{vendorMeta(vp)}</p>}
          </div>
        )
      },
    },
    {
      key: 'role', header: 'Role', width: 'w-44', sortValue: u => roleLabel(u.role),
      cell: u => u.id === currentUserId ? roleLabel(u.role) : (
        <Select label={`Role for ${vendorName(u)}`} hideLabel value={u.role} options={VENDOR_ROLE_OPTIONS}
          disabled={busyId === u.id} onChange={e => changeRole(u, e.target.value)} />
      ),
    },
    {
      key: 'status', header: 'Status', sortValue: u => (u.is_active ? 0 : 1),
      cell: u => <StatusPill tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Active' : 'Deactivated'}</StatusPill>,
    },
    { key: 'joined', header: 'Joined', hideBelow: 'lg', sortValue: u => new Date(u.created_at).getTime(), cell: u => formatDate(u.created_at) },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: u => (
        <div className="flex justify-end gap-2">
          <Link to="/admin/kyc" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>KYC review</Link>
          {u.id !== currentUserId && (
            <Button size="sm" variant={u.is_active ? 'secondary' : 'primary'} loading={busyId === u.id && update.variables?.data.is_active !== undefined}
              disabled={busyId === u.id} onClick={() => toggleActive(u)}>
              {u.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          )}
        </div>
      ),
    },
  ]

  if (myRole !== 'superadmin') {
    return <DataTable caption="Vendors" columns={columns} rows={[]} rowKey={u => u.id} empty={{ title: 'Only a superadmin can manage vendor accounts', description: 'Vendors and 3PL partners are reviewed under KYC review.' }} />
  }

  return (
    <DataTable
      caption="Vendors"
      columns={columns}
      rows={rows}
      rowKey={u => u.id}
      loading={users.isLoading}
      error={users.error ? 'We could not load vendors. Check your connection and try again.' : undefined}
      onRetry={() => users.refetch()}
      empty={{ title: search ? 'No vendors match your search' : 'No vendors yet', description: 'Vendors and 3PL partners are reviewed under KYC review.' }}
    />
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
