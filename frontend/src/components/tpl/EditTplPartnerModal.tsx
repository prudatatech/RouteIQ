import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Modal, Button, Input, Select, IfscField } from '@/components/ui'
import { ShieldCheck, Landmark, Building2, CheckCircle2 } from 'lucide-react'
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
}

const MSME_OPTIONS = TPL_MSME_OPTIONS.map(v => ({ value: v, label: v }))
const SLA_OPTIONS = SLA_COMMITMENT_OPTIONS.map(v => ({ value: v, label: v }))
const TAX_OPTIONS = TAX_TREATMENT_OPTIONS.map(v => ({ value: v, label: v }))

type TabKey = 'identity' | 'bank' | 'operations'

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
  if (!companyName.trim()) errors.companyName = 'Company name is required'
  if (!contactName.trim()) errors.contactName = 'Contact person is required'
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
  if (customId.trim() && !CUSTOM_ID_PATTERN.test(customId.trim())) {
    errors.customId = '3PL ID must be 5-20 lowercase letters, numbers or underscores'
  }

  const err = (key: string) => (attempted ? errors[key] : undefined)

  const panValidation = validatePanFormat(pan)
  const panCategory = getPanCategory(pan)
  const gstValidation = validateGstinFormat(gst, pan)

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault?.()
    setAttempted(true)
    if (Object.keys(errors).length > 0) {
      toast.error('Please fix the errors before saving.')
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        phone: phone.trim() || undefined,
        pan: pan.trim() ? pan.trim().toUpperCase() : null,
        gst: gst.trim() ? gst.trim().toUpperCase() : null,
        entityType: entityType || null,
        cin: cin.trim() ? cin.trim().toUpperCase() : null,
        authorizedSignatoryName: authorizedSignatoryName.trim() || null,
        msmeStatus,
        bankAccount: bankAccount.trim() || null,
        bankIfsc: bankIfsc.trim() ? bankIfsc.trim().toUpperCase() : null,
      }
      if (!isPartnerPortal) {
        payload.custom_id = customId.trim() || undefined
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
            {pan && <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />}
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
            {bankAccount && <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />}
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
              </div>

              <div>
                <Input
                  label="GSTIN"
                  value={gst}
                  onChange={e => setGst(e.target.value.toUpperCase().slice(0, 15))}
                  placeholder="07ABCDE1234F1Z5"
                  maxLength={15}
                  inputClassName="font-mono uppercase"
                  error={err('gst') || (gst.trim() && gstValidation.error ? gstValidation.error : undefined)}
                  hint="15 characters (Optional)"
                  trailing={gst.trim() && gstValidation.valid ? <CheckCircle2 size={16} className="text-success" /> : undefined}
                />
              </div>

              <Select
                label="Entity Type"
                value={entityType}
                onChange={e => setEntityType(e.target.value)}
                options={ENTITY_TYPE_OPTIONS}
                placeholder="Select entity type"
              />

              <Input
                label="Authorized Signatory Name"
                value={authorizedSignatoryName}
                onChange={e => setAuthorizedSignatoryName(e.target.value)}
                placeholder="Full name of signatory"
              />

              {requiresCin && (
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
              )}

              <Select
                label="MSME Registration"
                value={msmeStatus}
                onChange={e => setMsmeStatus(e.target.value)}
                options={MSME_OPTIONS}
              />
            </div>
          </div>
        )}

        {/* Tab 2: Bank & Payout */}
        {activeTab === 'bank' && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <IfscField
                value={bankIfsc}
                onChange={setBankIfsc}
              />
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
