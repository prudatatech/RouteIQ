import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Search, User } from 'lucide-react'
import { usersAPI, analyticsAPI } from '@/services/api'
import { Card, Badge, Button, Spinner } from '@/components/ui'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import CargoManifestConnectingForm from '@/components/CargoManifestConnectingForm'

const ROLE_OPTIONS = ['admin', 'manager', 'driver', 'superadmin', 'vendor']

export default function SuperadminPage() {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'users' | 'audit' | 'bids' | 'requests'>('users')
  const [showAddVendor, setShowAddVendor] = useState(false)
  const [selectedRequestToAssign, setSelectedRequestToAssign] = useState<any>(null)
  const [vendorEmail, setVendorEmail] = useState('')
  const [vendorPassword, setVendorPassword] = useState('')
  const queryClient = useQueryClient()

  const { data: users = [] as any[], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ['users'],
    queryFn: usersAPI.list,
  })

  const { data: auditLogs = [] as any[], isLoading: auditLoading } = useQuery<any[]>({
    queryKey: ['audit-logs'],
    queryFn: () => analyticsAPI.auditLogs(),
    enabled: activeTab === 'audit'
  })

  const { data: pendingBids = [] as any[], isLoading: bidsLoading } = useQuery<any[]>({
    queryKey: ['pending-bids'],
    queryFn: async () => {
      const { supabase } = await import('@/services/supabase')
      const res = await fetch('/api/v1/capacity/bids/pending', {
        headers: { 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch pending bids')
      return res.json()
    },
    enabled: activeTab === 'bids',
    refetchInterval: 5000 // Realtime polling for prototype
  })

  const { data: pendingRequests = [], isLoading: requestsLoading } = useQuery<any[]>({
    queryKey: ['pending-requests'],
    queryFn: async () => {
      const { supabase } = await import('@/services/supabase')
      const res = await fetch('/api/v1/vendor/shipment-request/pending', {
        headers: { 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch requests')
      return res.json()
    },
    enabled: activeTab === 'requests',
    refetchInterval: 5000
  })

  const approveBidMutation = useMutation({
    mutationFn: async (bidId: string) => {
      const { supabase } = await import('@/services/supabase')
      const res = await fetch(`/api/v1/capacity/bids/${bidId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }
      })
      if (!res.ok) throw new Error('Failed to approve bid')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-bids'] })
      toast.success('Bid approved and injected into route!')
    },
    onError: (err: any) => toast.error(err.message)
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersAPI.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated successfully')
    },
  })

  const addVendorMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/auth/invite-vendor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: vendorEmail, password: vendorPassword })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to create vendor')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Vendor account created successfully')
      setShowAddVendor(false)
      setVendorEmail('')
      setVendorPassword('')
    },
    onError: (err: any) => toast.error(err.message)
  })

  const filtered = users.filter((u: any) => {
    const s = search.toLowerCase();
    return (u.email || '').toLowerCase().includes(s) || 
           (u.full_name || '').toLowerCase().includes(s) ||
           (u.role === 'vendor' && (u.vendor_profiles?.[0]?.company_name || '').toLowerCase().includes(s));
  })

  const handleRoleChange = (userId: string, newRole: string) => {
    updateMutation.mutate({ id: userId, data: { role: newRole } })
  }

  const toggleActive = (userId: string, currentStatus: boolean) => {
    updateMutation.mutate({ id: userId, data: { is_active: !currentStatus } })
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div className="space-y-1">
          <h1 className="font-heading font-bold text-3xl text-text tracking-tight">Platform Administration</h1>
          <p className="text-muted text-sm flex items-center gap-2">
            <Shield size={14} className="text-purple-500" />
            Manage system users, access levels, and security policies
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-px overflow-x-auto">
        {['users', 'requests', 'bids', 'audit'].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t as any)}
            className={clsx(
              "px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all relative",
              activeTab === t ? "text-primary bg-primary/5" : "text-muted hover:text-text"
            )}
          >
            {t}
            {activeTab === t && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-[0_0_8px_rgba(79,172,254,0.6)]" />
            )}
          </button>
        ))}
      </div>

      {/* Filters + Search */}
      {activeTab === 'users' && (
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-2 bg-surface2 border border-border rounded-xl px-4 py-2 w-full max-w-sm focus-within:border-primary/30 transition-colors">
            <Search size={16} className="text-muted" />
            <input
              placeholder="Search users by email or name..."
              className="bg-transparent border-none outline-none text-sm text-text w-full placeholder:text-muted"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={() => setShowAddVendor(true)}>Add Vendor</Button>
        </div>
      )}

      {/* Content Table */}
      <Card className="border-border shadow-2xl relative overflow-hidden">
        {activeTab === 'users' ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {['User', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                    <th key={h} className="px-6 py-4 text-left text-[10px] font-bold text-muted uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr>
                    <td colSpan={5} className="py-20 text-center">
                      <Spinner size={32} />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-20 text-center text-muted text-xs">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filtered.map((u: any) => (
                    <tr key={u.id} className="border-b border-border hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-muted border border-border">
                            <User size={14} />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-text">
                              {u.role === 'vendor' && u.vendor_profiles?.[0] 
                                ? (u.vendor_profiles[0].company_name === 'New Vendor (Pending Setup)' || u.vendor_profiles[0].company_name.includes('Enterprise') 
                                    ? u.email 
                                    : u.vendor_profiles[0].company_name) 
                                : u.full_name}
                            </div>
                            <div className="text-[10px] text-muted mono">{u.email}</div>
                            <div className="text-[9px] text-muted opacity-50 mono">ID: {u.id}</div>
                            {u.role === 'vendor' && u.vendor_profiles?.[0] && (
                              <div className="flex flex-col gap-0.5 mt-1">
                                <div className="text-[9px] text-primary font-bold uppercase tracking-widest flex items-center gap-1">
                                  {u.vendor_profiles[0].city} <span className="opacity-50">|</span> GST: {u.vendor_profiles[0].gst_number}
                                </div>
                                <div className="text-[9px] text-muted font-normal max-w-xs truncate">
                                  {u.vendor_profiles[0].address}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {u.role === 'driver' ? (
                          <div className="bg-surface border border-border rounded-lg px-2 py-1 text-[10px] text-muted inline-block cursor-not-allowed uppercase font-bold tracking-widest opacity-70">
                            DRIVER (APP)
                          </div>
                        ) : (
                          <select
                            className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text outline-none focus:border-primary/50 uppercase font-bold"
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            disabled={updateMutation.isPending}
                          >
                            {ROLE_OPTIONS.filter(r => r !== 'driver').map(r => (
                              <option key={r} value={r}>{r.toUpperCase()}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={u.is_active ? 'green' : 'orange'}>
                          {u.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-[10px] text-muted mono">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <Button
                          size="sm"
                          variant={u.is_active ? 'ghost' : 'accent'}
                          className="text-[10px]"
                          onClick={() => toggleActive(u.id, u.is_active)}
                          disabled={updateMutation.isPending}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === 'requests' ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {['Vendor', 'Pickup', 'Drop', 'Capacity', 'Actions'].map(h => (
                    <th key={h} className="px-6 py-4 text-left text-[10px] font-bold text-muted uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requestsLoading ? (
                  <tr>
                    <td colSpan={5} className="py-20 text-center">
                      <Spinner size={32} />
                    </td>
                  </tr>
                ) : pendingRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-20 text-center text-muted text-xs">
                      No pending or approved requests
                    </td>
                  </tr>
                ) : (
                  pendingRequests.map((r: any) => (
                    <tr key={r.id} className="border-b border-border hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-text">{r.vendor_profiles?.company_name || 'Unknown Vendor'}</div>
                        <div className="text-[9px] text-muted mono">Req ID: {r.id.split('-')[0]}</div>
                      </td>
                      <td className="px-6 py-4 text-xs">
                        <div className="truncate max-w-[200px]" title={r.pickup_location}>{r.pickup_location}</div>
                        <div className="text-[9px] text-muted mono mt-0.5">{r.pickup_lat?.toFixed(4)}, {r.pickup_lng?.toFixed(4)}</div>
                      </td>
                      <td className="px-6 py-4 text-xs">
                        <div className="truncate max-w-[200px]" title={r.drop_location}>{r.drop_location}</div>
                        <div className="text-[9px] text-muted mono mt-0.5">{r.drop_lat?.toFixed(4)}, {r.drop_lng?.toFixed(4)}</div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm font-bold text-primary">
                        {r.required_capacity_kg} KG
                      </td>
                      <td className="px-6 py-4">
                        <Button
                          size="sm"
                          variant="accent"
                          className="text-[10px] font-bold shadow-lg shadow-primary/20"
                          onClick={() => setSelectedRequestToAssign(r)}
                        >
                          {r.status === 'pending' ? 'Approve & Assign' : 'Assign Vehicle'}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === 'bids' ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  {['Submitted', 'Bid ID', 'Vendor Details', 'Truck', 'Drop-off', 'Payload', 'Bid', 'Action'].map(h => (
                    <th key={h} className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bidsLoading ? (
                  <tr><td colSpan={8} className="py-20 text-center"><Spinner size={32} /></td></tr>
                ) : pendingBids.length === 0 ? (
                  <tr><td colSpan={8} className="py-20 text-center text-muted text-xs">No pending bids</td></tr>
                ) : (
                  pendingBids.map((bid: any) => (
                    <tr key={bid.id} className="border-b border-border hover:bg-white/[0.02] transition-colors text-xs font-bold">
                      <td className="px-6 py-4 text-muted mono text-[10px]">{new Date(bid.submitted_at).toLocaleString()}</td>
                      <td className="px-6 py-4 text-muted mono text-[10px] truncate max-w-[100px]">{bid.id}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-primary uppercase tracking-tight">{bid.vendor_profiles?.company_name} <span className="text-muted text-[10px]">({bid.vendor_profiles?.city})</span></span>
                          <span className="text-[10px] text-muted mono mt-1">Vendor ID: {bid.vendor_id}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-text">{bid.capacity_windows?.vehicles?.plate_number}</td>
                      <td className="px-6 py-4 text-text">
                        <div className="flex flex-col">
                          <span>{bid.delivery_points?.name}</span>
                          <span className="text-[10px] text-muted font-normal truncate max-w-[150px]">{bid.delivery_points?.address}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-text">
                        <div className="flex flex-col">
                          <span className="font-bold">{bid.weight_kg ? `${bid.weight_kg} KG` : 'N/A'}</span>
                          <span className="text-[10px] text-muted uppercase">{bid.load_configuration || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-success font-black text-sm">
                        <div className="flex flex-col">
                          <span>₹{bid.bid_amount}</span>
                          <span className="text-[10px] text-muted mono bg-surface2 px-1 py-0.5 rounded border border-border inline-block mt-1 truncate max-w-[80px]" title={bid.eway_bill_ref}>{bid.eway_bill_ref}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 flex gap-2">
                        <Button 
                          size="sm" 
                          onClick={() => approveBidMutation.mutate(bid.id)}
                          disabled={approveBidMutation.isPending}
                        >
                          Approve
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  {['Timestamp', 'Agent', 'Task', 'Status', 'Result'].map(h => (
                    <th key={h} className="px-6 py-4 text-[10px] font-bold text-muted uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditLoading ? (
                  <tr><td colSpan={5} className="py-20 text-center"><Spinner size={32} /></td></tr>
                ) : auditLogs.length === 0 ? (
                  <tr><td colSpan={5} className="py-20 text-center text-muted text-xs">No audit logs recorded</td></tr>
                ) : (
                  auditLogs.map((log: any) => (
                    <tr key={log.id} className="border-b border-border hover:bg-white/[0.02] transition-colors text-xs font-bold">
                      <td className="px-6 py-4 text-muted mono text-[10px]">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="px-6 py-4 text-primary uppercase tracking-tight">{log.agent}</td>
                      <td className="px-6 py-4 text-text max-w-xs truncate">{log.task}</td>
                      <td className="px-6 py-4">
                        <span className={clsx(
                          "px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border",
                          log.status === 'success' ? "bg-success/10 text-success border-success/20" : "bg-error/10 text-error border-error/20"
                        )}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted font-medium truncate max-w-xs">{log.result}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Vendor Modal */}
      {showAddVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface2/80 backdrop-blur-sm">
          <div className="bg-surface rounded-3xl w-full max-w-md p-8 shadow-2xl border border-border">
            <h2 className="text-2xl font-black uppercase tracking-tight mb-6">Create Vendor Account</h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">Vendor Email</label>
                <input
                  type="email"
                  value={vendorEmail}
                  onChange={e => setVendorEmail(e.target.value)}
                  className="w-full bg-surface2 border border-border rounded-xl px-4 py-3 text-text font-bold mt-1 outline-none focus:border-primary"
                  placeholder="vendor@example.com"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-muted tracking-widest ml-1">Temporary Password</label>
                <input
                  type="password"
                  value={vendorPassword}
                  onChange={e => setVendorPassword(e.target.value)}
                  className="w-full bg-surface2 border border-border rounded-xl px-4 py-3 text-text font-bold mt-1 outline-none focus:border-primary"
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <Button variant="ghost" className="flex-1" onClick={() => setShowAddVendor(false)}>Cancel</Button>
                <Button 
                  className="flex-1" 
                  onClick={() => addVendorMutation.mutate()}
                  disabled={addVendorMutation.isPending || !vendorEmail || !vendorPassword}
                >
                  {addVendorMutation.isPending ? <Spinner size={16} /> : 'Create Account'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cargo Manifest Connecting Form */}
      {selectedRequestToAssign && (
        <CargoManifestConnectingForm 
          request={selectedRequestToAssign}
          onClose={() => setSelectedRequestToAssign(null)}
          onAssigned={() => {
            setSelectedRequestToAssign(null);
            queryClient.invalidateQueries({ queryKey: ['pending-requests'] });
          }}
        />
      )}
    </div>
  )
}
