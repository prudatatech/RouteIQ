import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Building2 } from 'lucide-react'
import { Alert, Button, Card, CardHeader, IfscVerifiedHint, PageHeader, useConfirm } from '@/components/ui'
import { tplAPI } from '@/services/api'
import { CorridorEditor } from '@/components/tpl/CorridorEditor'
import { OperationalTermsFields } from '@/components/tpl/OperationalTermsFields'
import { corridorToFormRow, emptyCorridorRow, type CorridorFormRow } from '@/components/tpl/constants'
import { errorMessage } from '@/utils/display'
import { usePortal } from './portalContext'

interface SettingsForm { slaCommitment: string; taxTreatment: string; corridors: CorridorFormRow[] }

/** Settings: company details (read only) and the terms and lanes the partner can ask to change, which staff approve. */
export default function SettingsPage() {
  const { id } = useParams()
  const { partner, corridors, reload } = usePortal()
  const { confirm } = useConfirm()
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [saving, setSaving] = useState(false)

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

  const details: [string, string | null | undefined][] = [
    ['PAN', partner.pan_number],
    ['GSTIN', partner.gstin],
    ['MSME status', partner.msme_status],
    ['Bank A/C', partner.bank_account_no ? `****${String(partner.bank_account_no).slice(-4)}` : null],
    ['IFSC', partner.bank_ifsc],
    ['Bank', [partner.bank_name, partner.bank_branch].filter(Boolean).join(', ')],
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your company details, service terms and lanes." />

      <Card padded>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-text"><Building2 size={16} className="text-brand" /> Company details</h2>
        <dl className="space-y-3 text-sm">
          {details.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-right font-mono text-text">{value || '—'}</dd>
            </div>
          ))}
        </dl>
        {partner.bank_ifsc && <p className="mt-2 text-right"><IfscVerifiedHint verifiedAt={partner.bank_ifsc_verified_at} /></p>}
        <p className="mt-4 text-xs text-muted">To change these, contact MargixIndia dispatch.</p>
      </Card>

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
