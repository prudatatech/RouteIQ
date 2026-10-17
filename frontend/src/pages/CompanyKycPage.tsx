import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { orgAPI } from '@/services/api'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { Alert, Button, Card, IfscField, Input, LoadingState, Page, PageHeader, Select } from '@/components/ui'
import { DocUploadField } from '@/components/kyc/DocUploadField'
import { errorMessage } from '@/utils/display'
import { getKycDocumentUrl, uploadOrgKycDocument } from '@/services/kycDocuments'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { ORG_KYC_DOCUMENTS } from '@/utils/platformOrgs'
import { gstinError } from '@/utils/gstin'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'
import type { IfscDetails } from '@/services/api'

const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_PATTERN = /^\d{9,18}$/

/** A pending logistic company completes its KYC: GSTIN/PAN, bank account and the documents a reviewer checks. */
export default function CompanyKycPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const active = useOrgStore(selectActiveMembership)

  const profile = useQuery({ queryKey: ['org-kyc', active?.org.id], queryFn: () => orgAPI.get(), enabled: !!active })

  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')
  const [entityType, setEntityType] = useState('')
  const [cin, setCin] = useState('')
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAccountNo, setBankAccountNo] = useState('')
  const [bankIfsc, setBankIfsc] = useState('')
  const [ifscInfo, setIfscInfo] = useState<IfscDetails | null>(null)
  const [docUrls, setDocUrls] = useState<Record<string, string>>({})
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)

  useEffect(() => {
    if (!profile.data || loadedOnce) return
    const p = profile.data
    const bank = (p.profile ?? {}) as Record<string, unknown>
    setGstin(p.gstin ?? '')
    setPan(p.pan ?? '')
    setEntityType(p.entity_type ?? '')
    setCin(p.cin ?? '')
    setAuthorizedSignatoryName(p.authorized_signatory_name ?? '')
    setBankName(typeof bank.bank_name === 'string' ? bank.bank_name : '')
    setBankAccountNo(typeof bank.bank_account_no === 'string' ? bank.bank_account_no : '')
    setBankIfsc(typeof bank.bank_ifsc === 'string' ? bank.bank_ifsc : '')
    setDocUrls(p.kyc_documents?.docUrls ?? {})
    setLoadedOnce(true)
  }, [profile.data, loadedOnce])

  const saveDetails = useMutation({
    mutationFn: () => orgAPI.update({
      gstin: gstin.trim().toUpperCase() || undefined,
      pan: pan.trim().toUpperCase() || undefined,
      entity_type: entityType || undefined,
      cin: cin.trim().toUpperCase() || undefined,
      authorized_signatory_name: authorizedSignatoryName.trim() || undefined,
      profile: { bank_name: bankName.trim() || null, bank_account_no: bankAccountNo.trim() || null, bank_ifsc: bankIfsc.trim().toUpperCase() || null },
    }),
    onSuccess: () => { toast.success('Details saved'); void queryClient.invalidateQueries({ queryKey: ['org-kyc'] }) },
    onError: err => toast.error(errorMessage(err, 'We could not save these details. Try again.')),
  })

  const submit = useMutation({
    mutationFn: () => orgAPI.submitKyc(),
    onSuccess: () => { toast.success('Submitted for review'); navigate('/waiting-for-approval', { replace: true }) },
    onError: err => toast.error(errorMessage(err, 'We could not submit your KYC. Check everything below is filled in.')),
  })

  const uploadDoc = async (key: string, file: File) => {
    setUploadingKey(key)
    try {
      const path = await uploadOrgKycDocument(key, file)
      const updated = { ...docUrls, [key]: path }
      setDocUrls(updated)
      await orgAPI.saveKycDocuments({ docUrls: updated })
      void queryClient.invalidateQueries({ queryKey: ['org-kyc'] })
      toast.success('Document uploaded')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to upload document'))
    } finally {
      setUploadingKey(null)
    }
  }

  const removeDoc = async (key: string) => {
    const updated = { ...docUrls }
    delete updated[key]
    setDocUrls(updated)
    try {
      await orgAPI.saveKycDocuments({ docUrls: updated })
      void queryClient.invalidateQueries({ queryKey: ['org-kyc'] })
    } catch (err) {
      console.error('Failed to remove document', err)
    }
  }

  const openViewer = async (path: string, name: string) => {
    try {
      setViewer({ url: await getKycDocumentUrl(path), name })
    } catch {
      toast.error('We could not open this document. Try again.')
    }
  }

  if (!active) return <Navigate to="/register-company" replace />
  if (active.org.kind !== 'logistic_company') return <Navigate to="/today" replace />
  if (active.org.status === 'active' || active.org.status === 'suspended') return <Navigate to="/waiting-for-approval" replace />
  if (profile.isLoading) return <div className="flex min-h-screen items-center justify-center bg-bg"><LoadingState label="Loading" /></div>

  const issues = profile.data?.kyc_document_issues ?? {}
  const submitted = !!profile.data?.kyc_submitted_at
  const missingDocs = ORG_KYC_DOCUMENTS.filter(d => !docUrls[d.key])

  const fieldErrors: Record<string, string> = {}
  if (!gstin.trim()) fieldErrors.gstin = 'Enter the company GSTIN'
  else { const g = gstinError(gstin, pan); if (g) fieldErrors.gstin = g }
  if (!pan.trim()) fieldErrors.pan = 'Enter the company PAN'
  else if (!PAN_PATTERN.test(pan.trim())) fieldErrors.pan = 'PAN looks incorrect (e.g. AAAAA0000A)'
  if (!entityType.trim()) fieldErrors.entityType = 'Choose the entity type'
  if (!authorizedSignatoryName.trim()) fieldErrors.authorizedSignatoryName = 'Enter the authorized signatory name'
  if (entityTypeRequiresCin(entityType)) {
    if (!cin.trim()) fieldErrors.cin = 'CIN is required for this entity type'
    else if (!isCinFormat(cin)) fieldErrors.cin = 'CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456)'
  } else if (cin.trim() && !isCinFormat(cin)) {
    fieldErrors.cin = 'CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456)'
  }
  if (!bankAccountNo.trim()) fieldErrors.bankAccountNo = 'Enter the bank account number'
  else if (!ACCOUNT_PATTERN.test(bankAccountNo.trim())) fieldErrors.bankAccountNo = 'Account number must be 9 to 18 digits'
  if (!bankIfsc.trim()) fieldErrors.bankIfsc = 'Enter the IFSC code'
  else if (!IFSC_PATTERN.test(bankIfsc.trim())) fieldErrors.bankIfsc = 'IFSC has 11 characters: 4 letters, a 0, then 6 letters or digits'
  const canSubmit = Object.keys(fieldErrors).length === 0 && missingDocs.length === 0
  const err = (key: string) => (attemptedSubmit ? fieldErrors[key] : undefined)

  const trySubmit = () => {
    setAttemptedSubmit(true)
    if (canSubmit) submit.mutate()
  }

  return (
    <Page width="form">
      <PageHeader
        title="Complete your company KYC"
        description="GSTIN, PAN, your bank account and these documents are checked before your company is approved."
      />

      {submitted && <Alert tone="warning" title="Submitted">Your documents are with the MargixIndia team for review. You can still fix anything they flag below.</Alert>}
      {Object.keys(issues).length > 0 && (
        <Alert tone="warning" title="Fix these documents">
          <ul className="list-disc space-y-0.5 pl-4">
            {Object.entries(issues).map(([key, reason]) => (
              <li key={key}><span className="font-medium">{ORG_KYC_DOCUMENTS.find(d => d.key === key)?.label ?? key}</span>: {reason}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card padded className="space-y-6">
        <div>
          <p className="mb-3 text-sm font-medium text-text">Company details</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="GSTIN" value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15} inputClassName="uppercase" error={err('gstin')} />
            <Input label="PAN" value={pan} onChange={e => setPan(e.target.value.toUpperCase())} maxLength={10} inputClassName="uppercase" error={err('pan')} />
            <Select label="Entity type" value={entityType} onChange={e => setEntityType(e.target.value)} options={ENTITY_TYPE_OPTIONS} placeholder="Choose the entity type" error={err('entityType')} />
            {entityTypeRequiresCin(entityType) && (
              <Input label="CIN" value={cin} onChange={e => setCin(e.target.value.toUpperCase())} maxLength={21} inputClassName="uppercase" error={err('cin')} hint="21-character Corporate Identity Number" />
            )}
            <Input label="Authorized signatory name" value={authorizedSignatoryName} onChange={e => setAuthorizedSignatoryName(e.target.value)} error={err('authorizedSignatoryName')} />
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-text">Bank details</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Bank account number" value={bankAccountNo} onChange={e => setBankAccountNo(e.target.value.replace(/\D/g, '').slice(0, 18))} inputMode="numeric" hint="9 to 18 digits" error={err('bankAccountNo')} />
            <IfscField label="IFSC code" value={bankIfsc} onChange={setBankIfsc} onResolved={setIfscInfo} error={err('bankIfsc')} className="sm:col-span-2" />
            <Input label="Bank name" value={bankName || ifscInfo?.bank || ''} onChange={e => setBankName(e.target.value)} className="sm:col-span-2" />
          </div>
          <Button className="mt-3" variant="secondary" size="sm" loading={saveDetails.isPending} onClick={() => saveDetails.mutate()}>Save details</Button>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-text">Documents</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ORG_KYC_DOCUMENTS.map(d => (
              <DocUploadField
                key={d.key}
                label={d.label}
                hint={d.hint}
                path={docUrls[d.key]}
                issue={issues[d.key]}
                busy={uploadingKey === d.key}
                onUpload={file => uploadDoc(d.key, file)}
                onRemove={() => removeDoc(d.key)}
                onView={() => openViewer(docUrls[d.key], d.label)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button loading={submit.isPending} onClick={trySubmit}>
            {active.org.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
          </Button>
          {missingDocs.length > 0 && <p className="text-xs text-muted">Documents still needed: {missingDocs.map(d => d.label).join(', ')}</p>}
        </div>
        {attemptedSubmit && !canSubmit && missingDocs.length === 0 && (
          <Alert tone="danger" title="Fix the highlighted fields before submitting" />
        )}
      </Card>

      {viewer && <DocumentViewerModal isOpen onClose={() => setViewer(null)} fileUrl={viewer.url} fileName={viewer.name} />}
    </Page>
  )
}
