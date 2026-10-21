import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { AlertCircle, Building2, Edit } from 'lucide-react'
import { Alert, Button, Card, CardHeader, IfscVerifiedHint, PageHeader, useConfirm } from '@/components/ui'
import { tplAPI } from '@/services/api'
import { CorridorEditor } from '@/components/tpl/CorridorEditor'
import { OperationalTermsFields } from '@/components/tpl/OperationalTermsFields'
import { corridorToFormRow, emptyCorridorRow, type CorridorFormRow } from '@/components/tpl/constants'
import { EditTplPartnerModal } from '@/components/tpl/EditTplPartnerModal'
import { errorMessage } from '@/utils/display'
import { usePortal } from './portalContext'

interface SettingsForm { slaCommitment: string; taxTreatment: string; corridors: CorridorFormRow[] }

/** Settings: company details (read only) and the terms and lanes the partner can ask to change, which staff approve. */
export default function SettingsPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { partner, corridors, reload } = usePortal()
  const { confirm } = useConfirm()
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [editKycOpen, setEditKycOpen] = useState(false)

  useEffect(() => {
    if (searchParams.get('highlight') === 'flagged' || searchParams.get('open') === 'edit') {
      setEditKycOpen(true)
    }
  }, [searchParams])

  // Start from the request waiting for approval, else from the live terms
  useEffect(() => {
    if (form) return
    const pending = partner.pending_updates
    setForm({
      slaCommitment: pending?.sla_commitment || partner.sla_commitment || '2 Hours',
      taxTreatment: pending?.tax_treatment || partner.tax_treatment || '12% GTA (With ITC) - Forward Charge',
      corridors: pending?.corridors && pending.corridors.length > 0
        ? pending.corridors
        : corridors.length > 0
          ? corridors.map((c, i) => corridorToFormRow(c, i))
          : [emptyCorridorRow()],
    })
  }, [partner, corridors, form])

  const save = async () => {
    if (!form) return
    const ok = await confirm({
      title: 'Save these settings?',
      message: "Saving these changes will send your profile back for approval and pause any active operations until it's reviewed again.",
      confirmLabel: 'Save and resubmit',
      tone: 'danger',
    })
    if (!ok) return

    const named = form.corridors.filter(c => c.name.trim())
    if (named.length === 0) {
      toast.error('Add at least one lane you serve, for example DEL-BOM')
      return
    }
    setSaving(true)
    try {
      // Nothing changes until staff approve; the backend validates the request and tells staff.
      await tplAPI.requestSettings(id!, { sla_commitment: form.slaCommitment, tax_treatment: form.taxTreatment, corridors: named })
      reload()
      toast.success('Settings update requested. Awaiting approval.')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to submit the settings update.'))
    } finally {
      setSaving(false)
    }
  }

  const isMissingKyc = !partner.pan_number || !partner.bank_account_no
  const hasFieldIssues = partner.field_issues && Object.keys(partner.field_issues).length > 0

  const detailItems: { label: string; value: string | null | undefined; issueKey?: string }[] = [
    { label: '3PL ID', value: partner.custom_id, issueKey: 'custom_id' },
    { label: 'Company Name', value: partner.company_name, issueKey: 'company_name' },
    { label: 'PAN', value: partner.pan_number, issueKey: 'pan_number' },
    { label: 'GSTIN', value: partner.gstin, issueKey: 'gstin' },
    { label: 'Entity Type', value: partner.entity_type, issueKey: 'entity_type' },
    { label: 'MSME status', value: partner.msme_status, issueKey: 'msme_status' },
    { label: 'Bank A/C', value: partner.bank_account_no ? `****${String(partner.bank_account_no).slice(-4)}` : null, issueKey: 'bank_account_no' },
    { label: 'IFSC', value: partner.bank_ifsc, issueKey: 'bank_ifsc' },
    { label: 'Bank', value: [partner.bank_name, partner.bank_branch].filter(Boolean).join(', ') },
    { label: 'Operating Location', value: partner.operating_from, issueKey: 'operating_from' },
    { label: 'Fleet Size / Vehicles', value: partner.fleet_size, issueKey: 'fleet_size' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your company details, service terms and lanes." />

      {hasFieldIssues && (
        <Alert
          tone="warning"
          title="Attention: Application Details Flagged for Correction"
          action={
            <Button size="sm" onClick={() => setEditKycOpen(true)}>
              Fix Flagged Details
            </Button>
          }
        >
          Compliance has requested revisions for your details ({Object.keys(partner.field_issues!).map(k => k.replace(/_/g, ' ')).join(', ')}). Click &quot;Fix Flagged Details&quot; to review notes and update.
        </Alert>
      )}

      {isMissingKyc && !hasFieldIssues && (
        <Alert
          tone="warning"
          title="Complete your KYC & Bank Details"
          action={
            <Button size="sm" onClick={() => setEditKycOpen(true)}>
              Complete Details
            </Button>
          }
        >
          Your account is missing compliance details (PAN, GSTIN, and Bank Payout details). Please submit them to enable invoice settlement and load assignments.
        </Alert>
      )}

      <Card padded>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            <Building2 size={16} className="text-brand" /> Company details
          </h2>
          <Button
            size="sm"
            variant={hasFieldIssues ? 'primary' : 'secondary'}
            icon={<Edit size={14} />}
            onClick={() => setEditKycOpen(true)}
          >
            {hasFieldIssues ? 'Fix Flagged Details' : 'Edit KYC & Bank Details'}
          </Button>
        </div>
        <dl className="space-y-2.5 text-sm">
          {detailItems.map(item => {
            const issue = item.issueKey ? partner.field_issues?.[item.issueKey] : undefined
            return (
              <div
                key={item.label}
                className={clsx(
                  'rounded-control p-2.5 transition-all',
                  issue ? 'border border-warning bg-warning/5 ring-1 ring-warning/30 shadow-xs' : 'border border-transparent'
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <dt className="shrink-0 text-muted flex items-center gap-2">
                    {item.label}
                    {issue && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning/20 text-warning">
                        Fix requested
                      </span>
                    )}
                  </dt>
                  <dd className="min-w-0 break-words text-right font-mono text-text">{item.value || '—'}</dd>
                </div>
                {issue && (
                  <p className="mt-1.5 text-xs text-warning flex items-start gap-1 font-medium bg-warning/10 p-2 rounded-control">
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                    <span><strong>Reviewer feedback:</strong> {issue}</span>
                  </p>
                )}
              </div>
            )
          })}
        </dl>
        {partner.bank_ifsc && <p className="mt-2 text-right"><IfscVerifiedHint verifiedAt={partner.bank_ifsc_verified_at} /></p>}
      </Card>

      <EditTplPartnerModal
        open={editKycOpen}
        onClose={() => setEditKycOpen(false)}
        partner={partner}
        onSaved={reload}
        isPartnerPortal
      />

      {form && (
        <Card padded>
          <CardHeader title="Service terms and lanes" description="Changes are reviewed by MargixIndia before they apply." />
          <div className="space-y-8 pt-6">
            {partner.pending_updates && (
              <Alert tone="warning" title="Your update is waiting for approval">
                A new request replaces this one. Your current terms stay in place until it is approved.
              </Alert>
            )}
            <OperationalTermsFields
              slaCommitment={form.slaCommitment}
              taxTreatment={form.taxTreatment}
              onSlaChange={v => setForm(f => f && { ...f, slaCommitment: v })}
              onTaxChange={v => setForm(f => f && { ...f, taxTreatment: v })}
            />
            <div className="border-t border-border pt-8">
              <CorridorEditor corridors={form.corridors} onChange={rows => setForm(f => f && { ...f, corridors: rows })} />
            </div>
            <div className="flex justify-end border-t border-border pt-6">
              <Button loading={saving} onClick={save}>Submit for approval</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
