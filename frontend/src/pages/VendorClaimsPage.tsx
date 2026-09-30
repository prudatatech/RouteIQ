import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { claimsAPI, type CargoClaim } from '@/services/cargo'
import { vendorAPI } from '@/services/api'
import { useVendorContext } from '@/components/vendor/vendorContext'
import { claimableLoads, claimStatusText, loadPath, type VendorLoad } from '@/components/vendor/loads'
import RaiseClaimModal from '@/components/vendor/RaiseClaimModal'
import ClaimDocuments from '@/components/cargo/ClaimDocuments'
import { Steps } from '@/components/cargo/CargoBits'
import { claimSteps, claimTypeLabel } from '@/components/cargo/logic'
import {
  Button, buttonClasses, DataTable, DetailList, EmptyState, Modal, Page, PageHeader, StatusPill, type Column,
} from '@/components/ui'
import { formatDate, formatRupees } from '@/utils/display'

const TERMINAL = ['settled', 'rejected', 'withdrawn']

function ClaimDetail({ claim, loadId, onClose, onChanged }: { claim: CargoClaim; loadId: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{claim.code}</span> <StatusPill status={claim.status} /></span>}
      description={`${claimTypeLabel(claim.claim_type)} claim, filed ${formatDate(claim.created_at)}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5">
        <Steps steps={claimSteps(claim.status)} label="Claim progress" />
        <p className="text-sm text-text">{claimStatusText(claim)}</p>
        <DetailList
          items={[
            { label: 'Load', value: claim.tracking_id ? (loadId ? <Link to={loadPath(loadId)} className="font-mono text-brand hover:underline">{claim.tracking_id}</Link> : <span className="font-mono">{claim.tracking_id}</span>) : '—' },
            { label: 'Declared value', value: claim.declared_value != null ? formatRupees(claim.declared_value) : '—' },
            { label: 'Claimed', value: claim.claimed_amount != null ? formatRupees(claim.claimed_amount) : 'Not stated' },
            { label: 'Approved', value: claim.approved_amount != null ? formatRupees(claim.approved_amount) : '—' },
            { label: 'Settled', value: claim.settled_amount != null ? formatRupees(claim.settled_amount) : '—' },
          ]}
        />
        {claim.notes && (
          <div>
            <p className="text-xs text-muted">Notes</p>
            <p className="mt-0.5 whitespace-pre-line break-words text-sm text-text">{claim.notes}</p>
          </div>
        )}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Documents</h3>
          <ClaimDocuments claim={claim} readOnly={TERMINAL.includes(claim.status)} onSaved={onChanged} />
        </div>
      </div>
    </Modal>
  )
}

export default function VendorClaimsPage() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const { isVendor, isSignedIn } = useVendorContext()
  const [raising, setRaising] = useState(false)
  const openId = params.get('open')

  const claims = useQuery({ queryKey: ['vendor', 'claims'], queryFn: () => claimsAPI.list(), enabled: isVendor })
  const loads = useQuery<VendorLoad[]>({ queryKey: ['vendor', 'loads'], queryFn: () => vendorAPI.loads() as Promise<VendorLoad[]>, enabled: isVendor })

  const loadIdOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of loads.data ?? []) if (l.manifest_id) map.set(l.manifest_id, l.id)
    return map
  }, [loads.data])
  const claimable = useMemo(
    () => claimableLoads(loads.data ?? [], Date.now()).map(l => ({ id: l.id, label: `${l.code}: ${l.pickup ?? '—'} to ${l.drop ?? '—'}`, manifest_id: l.manifest_id as string })),
    [loads.data],
  )

  // A claim opened from a notification or a link; a claim raised a moment ago is on the list too
  const selected = (claims.data ?? []).find(c => c.id === openId) ?? null
  const setOpen = (id: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (id) next.set('open', id)
    else next.delete('open')
    return next
  }, { replace: true })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vendor'] })

  const columns: Column<CargoClaim>[] = [
    { key: 'code', header: 'Claim', sortValue: c => c.code, cell: c => <span className="font-mono text-sm font-medium">{c.code}</span> },
    { key: 'load', header: 'Load', hideOnMobile: true, sortValue: c => c.tracking_id ?? '', cell: c => <span className="font-mono text-sm">{c.tracking_id ?? '—'}</span> },
    { key: 'type', header: 'Type', sortValue: c => c.claim_type, cell: c => claimTypeLabel(c.claim_type) },
    { key: 'claimed', header: 'Claimed', align: 'right', hideOnMobile: true, sortValue: c => c.claimed_amount, cell: c => (c.claimed_amount != null ? <span className="tabular">{formatRupees(c.claimed_amount)}</span> : <span className="text-muted">Not stated</span>) },
    {
      key: 'outcome', header: 'Decided', align: 'right', hideBelow: 'lg', sortValue: c => c.settled_amount ?? c.approved_amount,
      cell: c => (c.settled_amount != null
        ? <span className="tabular">{formatRupees(c.settled_amount)} settled</span>
        : c.approved_amount != null ? <span className="tabular">{formatRupees(c.approved_amount)} approved</span> : <span className="text-muted">—</span>),
    },
    { key: 'filed', header: 'Filed', hideBelow: 'lg', sortValue: c => c.created_at, cell: c => formatDate(c.created_at) },
    { key: 'status', header: 'Status', sortValue: c => c.status, cell: c => <StatusPill status={c.status} /> },
  ]

  if (!isSignedIn || !isVendor) {
    return (
      <Page>
        <PageHeader title="Claims" description="Money you ask for when goods are damaged, short or lost." />
        <EmptyState
          title="Sign in to see your claims"
          action={<Link to={`/login?as=vendor&next=${encodeURIComponent('/vendor/claims')}`} className={buttonClasses({ variant: 'primary' })}>Sign in</Link>}
        />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Claims"
        description="Money you ask for when goods are damaged, short or lost. You can raise a claim within 7 days of delivery."
        actions={<Button icon={<Plus size={16} />} disabled={claimable.length === 0} onClick={() => setRaising(true)}>Raise a claim</Button>}
      />
      {!loads.isLoading && claimable.length === 0 && (
        <p className="text-sm text-muted">No load can take a claim right now. A load can be claimed on once it is delivered, partly delivered or lost, for 7 days.</p>
      )}

      <DataTable
        caption="Your claims"
        columns={columns}
        rows={claims.data ?? []}
        rowKey={c => c.id}
        selectedKey={selected?.id ?? null}
        onRowClick={c => setOpen(c.id)}
        loading={claims.isLoading}
        error={claims.isError ? 'We could not load your claims. Check your connection and try again.' : undefined}
        onRetry={() => claims.refetch()}
        initialSort={{ key: 'filed', direction: 'desc' }}
        empty={{ title: 'No claims', description: 'When goods arrive damaged, short or go missing, raise a claim from the load and follow it here.' }}
      />

      {selected && (
        <ClaimDetail claim={selected} loadId={selected.manifest_id ? loadIdOf.get(selected.manifest_id) ?? null : null} onClose={() => setOpen(null)} onChanged={refresh} />
      )}
      {raising && (
        <RaiseClaimModal
          open
          loads={claimable}
          onClose={() => setRaising(false)}
          onFiled={refresh}
        />
      )}
    </Page>
  )
}
