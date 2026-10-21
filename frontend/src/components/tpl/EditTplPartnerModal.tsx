import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Modal, Button, Input, Select, IfscField, Alert } from '@/components/ui'
import { ShieldCheck, Landmark, Building2, CheckCircle2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { tplAPI } from '@/services/api'
import { errorMessage } from '@/utils/display'
import { gstinError } from '@/utils/gstin'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'
import { validatePanFormat, validateGstinFormat, getPanCategory } from '@/utils/taxValidation'
import { TPL_MSME_OPTIONS, SLA_COMMITMENT_OPTIONS, TAX_TREATMENT_OPTIONS } from './constants'

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const ACCOUNT_PATTERN = /^\d{9,18}$/
const CUSTOM_ID_PATTERN = /^[a-z0-9_]{5,20}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/

interface PartnerLike {
  id: string
  company_name: string
  contact_name?: string | null
  phone?: string | null
  custom_id?: string | null
  pan_number?: string | null
  gstin?: string | null
  entity_type?: string | null
  cin?: string | null
  authorizedSignatoryName?: string | null
  authorized_signatory_name?: string | null
  msme_status?: string | null
  bank_account_no?: string | null
  bank_ifsc?: string | null
  bank_name?: string | null
  bank_branch?: string | null
  sla_commitment?: string | null
  tax_treatment?: string | null
  field_issues?: Record<string, string> | null
}

const MSME_OPTIONS = TPL_MSME_OPTIONS.map(v => ({ value: v, label: v }))
const SLA_OPTIONS = SLA_COMMITMENT_OPTIONS.map(v => ({ value: v, label: v }))
const TAX_OPTIONS = TAX_TREATMENT_OPTIONS.map(v => ({ value: v, label: v }))

type TabKey = 'identity' | 'bank' | 'operations'

const FIELD_TABS: Record<string, TabKey> = {
  pan: 'identity',
  gst: 'identity',
  entityType: 'identity',
  cin: 'identity',
  authorizedSignatoryName: 'identity',
  msmeStatus: 'identity',
  bankAccount: 'bank',
  bankIfsc: 'bank',
  companyName: 'operations',
  contactName: 'operations',
  phone: 'operations',
  customId: 'operations',
}

export function EditTplPartnerModal({
  open,
  onClose,
  partner,
  onSaved,
  isPartnerPortal = false,
}: {
  open: boolean
  onClose: () => void
  partner: PartnerLike
  onSaved: () => void
  isPartnerPortal?: boolean
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('identity')
  const [companyName, setCompanyName] = useState(partner.company_name || '')
  const [contactName, setContactName] = useState(partner.contact_name || '')
  const [phone, setPhone] = useState(partner.phone || '')
  const [customId, setCustomId] = useState(partner.custom_id || '')
  const [pan, setPan] = useState(partner.pan_number || '')
  const [gst, setGst] = useState(partner.gstin || '')
  const [entityType, setEntityType] = useState(partner.entity_type || '')
  const [cin, setCin] = useState(partner.cin || '')
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState(
    partner.authorized_signatory_name || partner.authorizedSignatoryName || ''
  )
  const [msmeStatus, setMsmeStatus] = useState(partner.msme_status || 'Not Registered')
  const [bankAccount, setBankAccount] = useState(partner.bank_account_no || '')
  const [bankIfsc, setBankIfsc] = useState(partner.bank_ifsc || '')
  const [slaCommitment, setSlaCommitment] = useState(partner.sla_commitment || '2 Hours')
  const [taxTreatment, setTaxTreatment] = useState(partner.tax_treatment || '12% GTA (With ITC) - Forward Charge')

  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const fieldIssue = (key: string) => {
    const issues = partner.field_issues
    if (!issues) return undefined
    const aliases: Record<string, string[]> = {
      pan: ['pan_number', 'pan'],
      gst: ['gstin', 'gst'],
      bankAccount: ['bank_account_no', 'bankAccount', 'bank_account'],
      bankIfsc: ['bank_ifsc', 'bankIfsc'],
      entityType: ['entity_type', 'entityType'],
      cin: ['cin'],
      authorizedSignatoryName: ['authorized_signatory_name', 'authorizedSignatoryName'],
      companyName: ['company_name', 'companyName'],
      contactName: ['contact_name', 'contactName'],
      phone: ['phone'],
      msmeStatus: ['msme_status', 'msmeStatus'],
    }
    const candidates = aliases[key] || [key]
    for (const c of candidates) {
      if (issues[c]) return issues[c]
    }
    return undefined
  }

  const tabHasFlagged = (tab: TabKey) => {
    if (!partner.field_issues) return false
    return Object.entries(FIELD_TABS).some(([k, t]) => t === tab && fieldIssue(k))
  }

  // Reset fields when partner or open status changes
  useEffect(() => {
    if (open) {
      setCompanyName(partner.company_name || '')
      setContactName(partner.contact_name || '')
      setPhone(partner.phone || '')
      setCustomId(partner.custom_id || '')
      setPan(partner.pan_number || '')
      setGst(partner.gstin || '')
      setEntityType(partner.entity_type || '')
      setCin(partner.cin || '')
      setAuthorizedSignatoryName(
        partner.authorized_signatory_name || partner.authorizedSignatoryName || ''
      )
      setMsmeStatus(partner.msme_status || 'Not Registered')
      setBankAccount(partner.bank_account_no || '')
      setBankIfsc(partner.bank_ifsc || '')
      setSlaCommitment(partner.sla_commitment || '2 Hours')
      setTaxTreatment(partner.tax_treatment || '12% GTA (With ITC) - Forward Charge')
      setAttempted(false)
      setActiveTab('identity')
    }
  }, [open, partner])

  const requiresCin = entityTypeRequiresCin(entityType)

  const errors: Record<string, string> = {}
  if (!isPartnerPortal) {
    if (!companyName.trim()) errors.companyName = 'Company name is required'
    if (!contactName.trim()) errors.contactName = 'Contact person is required'
    if (customId.trim() && !CUSTOM_ID_PATTERN.test(customId.trim())) {
      errors.customId = '3PL ID must be 5-20 lowercase letters, numbers or underscores'
    }
  }
  if (pan.trim() && !PAN_PATTERN.test(pan.trim().toUpperCase())) {
    errors.pan = 'PAN looks incorrect (e.g. ABCDE1234F)'
  }
  if (gst.trim()) {
    const err = gstinError(gst.trim().toUpperCase(), pan.trim().toUpperCase() || undefined)
    if (err) errors.gst = err
  }
  if (requiresCin && cin.trim() && !isCinFormat(cin.trim().toUpperCase())) {
    errors.cin = 'CIN must be 21 letters/digits (e.g. U74999DL2019PTC123456)'
  }
  if (bankAccount.trim() && !ACCOUNT_PATTERN.test(bankAccount.trim())) {
    errors.bankAccount = 'Account number must be 9 to 18 digits'
  }
  if (bankIfsc.trim() && !IFSC_PATTERN.test(bankIfsc.trim().toUpperCase())) {
    errors.bankIfsc = 'IFSC must be 11 characters (e.g. HDFC0001234)'
  }

  const err = (key: string) => (attempted ? errors[key] : undefined)

  const panValidation = validatePanFormat(pan)
  const panCategory = getPanCategory(pan)
  const gstValidation = validateGstinFormat(gst, pan)

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault?.()
    setAttempted(true)
    const errorEntries = Object.entries(errors)
    if (errorEntries.length > 0) {
      const [firstField, firstMsg] = errorEntries[0]
      const targetTab = FIELD_TABS[firstField]
      if (targetTab && targetTab !== activeTab) {
        setActiveTab(targetTab)
      }
      toast.error(firstMsg || 'Please fix the errors before saving.')
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        pan: pan.trim() ? pan.trim().toUpperCase() : null,
        gst: gst.trim() ? gst.trim().toUpperCase() : null,
        entityType: entityType.trim() ? entityType.trim() : null,
        cin: cin.trim() ? cin.trim().toUpperCase() : null,
        authorizedSignatoryName: authorizedSignatoryName.trim() ? authorizedSignatoryName.trim() : null,
        msmeStatus,
        bankAccount: bankAccount.trim() ? bankAccount.trim() : null,
        bankIfsc: bankIfsc.trim() ? bankIfsc.trim().toUpperCase() : null,
      }
      if (!isPartnerPortal) {
        if (companyName.trim()) payload.companyName = companyName.trim()
        if (contactName.trim()) payload.contactName = contactName.trim()
        if (phone.trim()) payload.phone = phone.trim()
        if (customId.trim()) payload.custom_id = customId.trim()
        payload.slaCommitment = slaCommitment
        payload.taxTreatment = taxTreatment
      }
      await tplAPI.updateApplication(partner.id, payload)
      toast.success(isPartnerPortal ? 'KYC details submitted' : 'Partner details updated')
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Failed to update partner details.'))
    } finally {
      setSaving(false)
    }
  }

  const tabHasError = (tab: TabKey) => attempted && Object.keys(errors).some(k => FIELD_TABS[k] === tab)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isPartnerPortal ? 'Complete KYC & Bank Details' : `Edit details: ${partner.company_name}`}
      description={
        isPartnerPortal
          ? 'Enter your company PAN, GST, and bank account for verification and payouts.'
          : 'Update compliance, identity, bank, and operational details for this partner.'
      }
      onSubmit={handleSave}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save Details
          </Button>
        </>
      )}
    >
      <div className="space-y-6 max-h-[72vh] overflow-y-auto px-1 -mx-1">
        {partner.field_issues && Object.keys(partner.field_issues).length > 0 && (
          <Alert tone="warning" title="Platform Reviewer Requested Revisions">
            The platform reviewer flagged one or more details on your application for correction. Please check the feedback notes on the highlighted fields below.
          </Alert>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-border -mx-1 overflow-x-auto no-scrollbar scroll-smooth">
          <button
            type="button"
            onClick={() => setActiveTab('identity')}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer',
              activeTab === 'identity'
                ? 'border-brand text-brand'
                : 'border-transparent text-muted hover:text-text'
            )}
          >
            <ShieldCheck size={14} />
            Legal & Tax
            {tabHasFlagged('identity') ? (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-warning/20 text-warning">Fix requested</span>
            ) : tabHasError('identity') ? (
              <span className="h-1.5 w-1.5 rounded-full bg-danger inline-block" title="Has errors" />
            ) : pan ? (
              <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bank')}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer',
              activeTab === 'bank'
                ? 'border-brand text-brand'
                : 'border-transparent text-muted hover:text-text'
            )}
          >
            <Landmark size={14} />
            Bank & Payout
            {tabHasFlagged('bank') ? (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-warning/20 text-warning">Fix requested</span>
            ) : tabHasError('bank') ? (
              <span className="h-1.5 w-1.5 rounded-full bg-danger inline-block" title="Has errors" />
            ) : bankAccount ? (
              <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
            ) : null}
          </button>
          {!isPartnerPortal && (
            <button
              type="button"
              onClick={() => setActiveTab('operations')}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                activeTab === 'operations'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted hover:text-text'
              )}
            >
              <Building2 size={14} />
              Operations & Profile
              {tabHasFlagged('operations') ? (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-warning/20 text-warning">Fix requested</span>
              ) : tabHasError('operations') && (
                <span className="h-1.5 w-1.5 rounded-full bg-danger inline-block" title="Has errors" />
              )}
            </button>
          )}
        </div>

        {/* Tab 1: Legal & Tax */}
        {activeTab === 'identity' && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Input
                  label="Company PAN"
                  value={pan}
                  onChange={e => setPan(e.target.value.toUpperCase().slice(0, 10))}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  inputClassName="font-mono uppercase"
                  error={err('pan')}
                  hint={panValidation.valid && panCategory ? `${panCategory}` : 'e.g. ABCDE1234F'}
                  trailing={panValidation.valid ? <CheckCircle2 size={16} className="text-success" /> : undefined}
                />
                {fieldIssue('pan') && (
                  <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Fix requested:</strong> {fieldIssue('pan')}</span>
                  </div>
                )}
              </div>

              <div>
                <Input
                  label="GSTIN"
                  value={gst}
                  onChange={e => {
                    const val = e.target.value.toUpperCase().slice(0, 15)
                    setGst(val)
                    if (!pan && val.length >= 12 && PAN_PATTERN.test(val.slice(2, 12))) {
                      setPan(val.slice(2, 12))
                    }
                  }}
                  placeholder="07ABCDE1234F1Z5"
                  maxLength={15}
                  inputClassName="font-mono uppercase"
                  error={err('gst') || (gst.trim() && gstValidation.error ? gstValidation.error : undefined)}
                  hint="15 characters (Optional)"
                  trailing={gst.trim() && gstValidation.valid ? <CheckCircle2 size={16} className="text-success" /> : undefined}
                />
                {fieldIssue('gst') && (
                  <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Fix requested:</strong> {fieldIssue('gst')}</span>
                  </div>
                )}
              </div>

              <div>
                <Select
                  label="Entity Type"
                  value={entityType}
                  onChange={e => setEntityType(e.target.value)}
                  options={ENTITY_TYPE_OPTIONS}
                  placeholder="Select entity type"
                />
                {fieldIssue('entityType') && (
                  <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Fix requested:</strong> {fieldIssue('entityType')}</span>
                  </div>
                )}
              </div>

              <div>
                <Input
                  label="Authorized Signatory Name"
                  value={authorizedSignatoryName}
                  onChange={e => setAuthorizedSignatoryName(e.target.value)}
                  placeholder="Full name of signatory"
                />
                {fieldIssue('authorizedSignatoryName') && (
                  <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Fix requested:</strong> {fieldIssue('authorizedSignatoryName')}</span>
                  </div>
                )}
              </div>

              {requiresCin && (
                <div>
                  <Input
                    label="Corporate Identification Number (CIN)"
                    value={cin}
                    onChange={e => setCin(e.target.value.toUpperCase().slice(0, 21))}
                    placeholder="U74999DL2019PTC123456"
                    maxLength={21}
                    inputClassName="font-mono uppercase"
                    error={err('cin')}
                    hint="21 characters (required for Pvt Ltd/LLP)"
                  />
                  {fieldIssue('cin') && (
                    <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span><strong>Fix requested:</strong> {fieldIssue('cin')}</span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <Select
                  label="MSME Registration"
                  value={msmeStatus}
                  onChange={e => setMsmeStatus(e.target.value)}
                  options={MSME_OPTIONS}
                />
                {fieldIssue('msmeStatus') && (
                  <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Fix requested:</strong> {fieldIssue('msmeStatus')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Bank & Payout */}
        {activeTab === 'bank' && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Input
                  label="Bank Account Number"
                  value={bankAccount}
                  onChange={e => setBankAccount(e.target.value.replace(/\D/g, '').slice(0, 18))}
                  placeholder="9 to 18 digits"
                  inputMode="numeric"
                  inputClassName="font-mono"
                  error={err('bankAccount')}
                  hint={bankAccount ? `${bankAccount.length} digits entered` : '9 to 18 digits'}
                />
                {fieldIssue('bankAccount') && (
                  <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Fix requested:</strong> {fieldIssue('bankAccount')}</span>
                  </div>
                )}
              </div>
              <div>
                <IfscField
                  value={bankIfsc}
                  onChange={setBankIfsc}
                  error={err('bankIfsc')}
                />
                {fieldIssue('bankIfsc') && (
                  <div className="mt-1.5 rounded-control bg-warning/10 border border-warning/30 p-2 text-xs text-warning flex items-start gap-1.5">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Fix requested:</strong> {fieldIssue('bankIfsc')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Operations & Profile (Staff Only) */}
        {!isPartnerPortal && activeTab === 'operations' && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Company Name"
                required
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                error={err('companyName')}
              />
              <Input
                label="Contact Person"
                required
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                error={err('contactName')}
              />
              <Input
                label="Phone Number"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91..."
              />
              <Input
                label="3PL ID"
                value={customId}
                onChange={e => setCustomId(e.target.value.toLowerCase().slice(0, 20))}
                placeholder="e.g. nilons_1234"
                inputClassName="font-mono"
                error={err('customId')}
                hint="5-20 lowercase alphanumeric characters"
              />
              <Select
                label="SLA Commitment"
                value={slaCommitment}
                onChange={e => setSlaCommitment(e.target.value)}
                options={SLA_OPTIONS}
              />
              <Select
                label="GTA Tax Treatment"
                value={taxTreatment}
                onChange={e => setTaxTreatment(e.target.value)}
                options={TAX_OPTIONS}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
