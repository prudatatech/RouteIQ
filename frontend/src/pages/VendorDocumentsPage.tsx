import { useState, useEffect } from 'react'
import { supabase } from '@/services/supabase'
import { FileText, Upload, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import toast from 'react-hot-toast'

export default function VendorDocumentsPage() {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [kycStatus, setKycStatus] = useState<'pending' | 'submitted' | 'approved' | 'rejected'>('pending')
  const [activeSection, setActiveSection] = useState(1)
  const [activeMainTab, setActiveMainTab] = useState<'kyc' | 'other'>('kyc')
  const [isEditingKyc, setIsEditingKyc] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerFile, setViewerFile] = useState({ url: '', name: '' })

  const [formData, setFormData] = useState({
    name: '',
    number: '',
    country: 'India',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    contactPerson: '',
    telephone: '',
    mobileNumber: '',
    emailAddress: '',
    bankAccountNumber: '',
    beneficiaryAccountName: '',
    bankName: '',
    bankBranchName: '',
    bankAddress: '',
    bankBranchState: '',
    bankMicrCode: '',
    bankIfscCode: '',
    accountType: 'Current',
    currency: 'INR',
    panNumber: '',
    tanNumber: '',
    gstNumber: '',
    gstinDivision: '',
    vendorType: 'Service Provider',
    reasonNoGst: '',
    msmeStatus: 'Not Applicable',
    msmeCertDate: '',
    msmeRegNumber: '',
    declaration: false,
    documents: {
      softCopyExcel: null as any,
      softCopyPdf: null as any,
      panScan: null as any,
      cancelledCheque: null as any,
      gstRegistration: null as any,
      msmeCert: null as any,
      companyLogo: null as any,
    },
    docUrls: {} as any
  })

  const [otherDocs, setOtherDocs] = useState<{name: string, url: string}[]>([])

  const userId = useAuthStore(s => s.userId)
  const navigate = useNavigate()

  useEffect(() => {
    if (!userId) {
      navigate('/vendor/login')
      return
    }

    const loadProfile = async () => {
      try {
        const { data: profile, error } = await supabase
          .from('vendor_profiles')
          .select('*')
          .eq('id', userId)
          .single()

        if (profile) {
          setVendorId(profile.id)
          let parsedKyc: any = null
          
          if (profile.dummy2) {
            try {
              parsedKyc = typeof profile.dummy2 === 'string' ? JSON.parse(profile.dummy2) : profile.dummy2
              setKycStatus((parsedKyc.status || 'pending').toLowerCase() as any)
              
              if (parsedKyc.data) {
                setFormData(prev => ({ ...prev, ...parsedKyc.data }))
              }
              if (parsedKyc.otherDocs) {
                setOtherDocs(parsedKyc.otherDocs)
              }
            } catch(e) {}
          } else {
            // Auto fill available
            setFormData(prev => ({
              ...prev,
              name: profile.company_name || '',
              gstNumber: profile.gst_number || '',
              addressLine1: profile.address || '',
              city: profile.city || '',
              number: profile.city ? `VND-${profile.city.substring(0,3).toUpperCase()}-${Math.floor(Math.random()*1000)}` : ''
            }))
          }
          
          // Also check dedicated kyc_profiles table for admin-set status
          const { data: kycRow } = await supabase
            .from('kyc_profiles')
            .select('kyc_status')
            .eq('id', userId)
            .maybeSingle()
          if (kycRow && kycRow.kyc_status) {
            setKycStatus(kycRow.kyc_status.toLowerCase() as any)
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [userId])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]
    
    // Upload to Supabase Storage
    const fileExt = file.name.split('.').pop()
    const fileName = `${userId}/${key}_${Math.random()}.${fileExt}`

    try {
      setSubmitting(true)
      const { data, error } = await supabase.storage
        .from('kyc_documents')
        .upload(fileName, file)

      if (error) throw error

      const { data: urlData } = supabase.storage.from('kyc_documents').getPublicUrl(fileName)

      setFormData(prev => ({
        ...prev,
        documents: { ...prev.documents, [key]: file },
        docUrls: { ...prev.docUrls, [key]: urlData.publicUrl }
      }))
    } catch(err) {
      console.error("Upload error", err)
      alert("Failed to upload document")
    } finally {
      setSubmitting(false)
    }
  }

  const handleOtherFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]
    const fileExt = file.name.split('.').pop()
    const fileName = `${userId}/other_${Date.now()}_${Math.random()}.${fileExt}`

    try {
      setSubmitting(true)
      const { error } = await supabase.storage.from('kyc_documents').upload(fileName, file)
      if (error) throw error

      const { data: urlData } = supabase.storage.from('kyc_documents').getPublicUrl(fileName)
      
      const newDoc = { name: file.name, url: urlData.publicUrl }
      const updatedDocs = [...otherDocs, newDoc]
      setOtherDocs(updatedDocs)

      // Save immediately to profile
      const { data: profile } = await supabase.from('vendor_profiles').select('dummy2').eq('id', userId).single()
      const parsedKyc = profile?.dummy2 ? JSON.parse(profile.dummy2) : { status: 'pending', data: formData }
      parsedKyc.otherDocs = updatedDocs
      
      await supabase.from('vendor_profiles').update({ dummy2: JSON.stringify(parsedKyc) }).eq('id', userId)
      toast.success('Document uploaded successfully')

    } catch(err) {
      console.error(err)
      toast.error('Failed to upload document')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemoveOtherDoc = async (index: number) => {
    const updatedDocs = otherDocs.filter((_, i) => i !== index)
    setOtherDocs(updatedDocs)
    
    try {
      const { data: profile } = await supabase.from('vendor_profiles').select('dummy2').eq('id', userId).single()
      const parsedKyc = profile?.dummy2 ? JSON.parse(profile.dummy2) : { status: 'pending', data: formData }
      parsedKyc.otherDocs = updatedDocs
      await supabase.from('vendor_profiles').update({ dummy2: JSON.stringify(parsedKyc) }).eq('id', userId)
      toast.success('Document removed')
    } catch (e) {
      console.error(e)
    }
  }

  const handleRemoveFile = async (key: string) => {
    // Optionally remove from storage, or just clear locally
    setFormData(prev => {
      const newDocs: Record<string, any> = { ...prev.documents }
      const newUrls: Record<string, any> = { ...prev.docUrls }
      delete newDocs[key]
      delete newUrls[key]
      return { ...prev, documents: newDocs as any, docUrls: newUrls as any }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.declaration) {
      alert("Please check the declaration box")
      return
    }

    setSubmitting(true)
    try {
      const kycPayload = {
        status: 'submitted',
        data: formData
      }

      const { error } = await supabase
        .from('vendor_profiles')
        .update({
          dummy2: JSON.stringify(kycPayload),
          company_name: formData.name || undefined,
          city: formData.city || undefined,
          company_logo: formData.docUrls.companyLogo || undefined
        })
        .eq('id', userId)

      if (error) throw error

      window.dispatchEvent(new Event('vendor-profile-updated'))

      setKycStatus('submitted')
      setIsEditingKyc(false)
      window.scrollTo(0, 0)
    } catch (err) {
      console.error(err)
      alert("Failed to submit KYC")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-text"><Clock className="animate-spin mr-2"/> Loading...</div>

  const isReadOnly = (kycStatus === 'submitted' || kycStatus === 'approved') && !isEditingKyc
  
  const StatusBanner = () => {
    if (kycStatus === 'approved') return (
      <div className="bg-emerald-500/20 text-green-400 p-4 rounded-xl border border-emerald-500/30 flex items-center justify-between mb-8">
        <div className="flex items-center">
          <CheckCircle className="w-6 h-6 mr-3" />
          <div>
            <h3 className="font-semibold text-lg">KYC Approved</h3>
            <p className="text-sm opacity-90">Your documents have been verified. You can now post loads and accept shipments.</p>
          </div>
        </div>
        {!isEditingKyc && (
          <button onClick={() => setIsEditingKyc(true)} className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-sm font-bold border border-emerald-500/30 transition-colors">
            Update Details
          </button>
        )}
      </div>
    )
    if (kycStatus === 'submitted') return (
      <div className="bg-amber-500/20 text-amber-400 p-4 rounded-xl border border-amber-500/30 flex items-center justify-between mb-8">
        <div className="flex items-center">
          <Clock className="w-6 h-6 mr-3" />
          <div>
            <h3 className="font-semibold text-lg">Verification Pending</h3>
            <p className="text-sm opacity-90">Your KYC is under review by our admin team. You will be notified once approved.</p>
          </div>
        </div>
        {!isEditingKyc && (
          <button onClick={() => setIsEditingKyc(true)} className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-sm font-bold border border-amber-500/30 transition-colors">
            Update Details
          </button>
        )}
      </div>
    )
    if (kycStatus === 'rejected') return (
      <div className="bg-red-500/20 text-red-400 p-4 rounded-xl border border-red-500/30 flex items-center mb-8">
        <AlertCircle className="w-6 h-6 mr-3" />
        <div>
          <h3 className="font-semibold text-lg">KYC Rejected</h3>
          <p className="text-sm opacity-90">Please review and correct your details below.</p>
        </div>
      </div>
    )
    return (
      <div className="bg-primary/20 text-primary p-4 rounded-xl border border-primary/30 flex items-center mb-8">
        <AlertCircle className="w-6 h-6 mr-3" />
        <div>
          <h3 className="font-semibold text-lg">Action Required</h3>
          <p className="text-sm opacity-90">Complete your KYC to unlock full vendor capabilities.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-text p-6 md:p-10 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <FileText className="w-8 h-8 text-primary mr-3" />
            <h1 className="text-3xl font-bold text-text">Vendor Documents</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-2 border-b border-border mb-8">
          <button
            onClick={() => setActiveMainTab('kyc')}
            className={`px-6 py-3 font-bold text-sm tracking-wide transition-colors border-b-2 ${
              activeMainTab === 'kyc' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            KYC Form
          </button>
          <button
            onClick={() => setActiveMainTab('other')}
            className={`px-6 py-3 font-bold text-sm tracking-wide transition-colors border-b-2 ${
              activeMainTab === 'other' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            Other Documents
          </button>
        </div>

        {activeMainTab === 'kyc' && (
          <>
            <StatusBanner />

            <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Section 1: Basic Information */}
          <Section title="1. Basic Information" isActive={activeSection === 1} onToggle={() => setActiveSection(activeSection === 1 ? 0 : 1)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Name (Vendor/Company)" required value={formData.name} onChange={(v: string) => setFormData({...formData, name: v})} readOnly={isReadOnly} />
              <Input label="Vendor Number (Auto)" readOnly value={formData.number} onChange={(v: string) => setFormData({...formData, number: v})} />
              <Input label="Country" required value={formData.country} onChange={(v: string) => setFormData({...formData, country: v})} readOnly={isReadOnly} />
              <Input label="City" required value={formData.city} onChange={(v: string) => setFormData({...formData, city: v})} readOnly={isReadOnly} />
              <Input label="State" required value={formData.state} onChange={(v: string) => setFormData({...formData, state: v})} readOnly={isReadOnly} />
              <Input label="Postal Code" required value={formData.postalCode} onChange={(v: string) => setFormData({...formData, postalCode: v})} readOnly={isReadOnly} />
              <div className="md:col-span-2">
                <Input label="Address Line 1" required value={formData.addressLine1} onChange={(v: string) => setFormData({...formData, addressLine1: v})} readOnly={isReadOnly} />
              </div>
            </div>
          </Section>

          {/* Section 2: Contact Information */}
          <Section title="2. Contact Information" isActive={activeSection === 2} onToggle={() => setActiveSection(activeSection === 2 ? 0 : 2)}>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Contact Person" required value={formData.contactPerson} onChange={(v: string) => setFormData({...formData, contactPerson: v})} readOnly={isReadOnly} />
              <Input label="Email Address" type="email" required value={formData.emailAddress} onChange={(v: string) => setFormData({...formData, emailAddress: v})} readOnly={isReadOnly} />
              <Input label="Mobile Number" required value={formData.mobileNumber} onChange={(v: string) => setFormData({...formData, mobileNumber: v})} readOnly={isReadOnly} />
              <Input label="Telephone (with STD)" value={formData.telephone} onChange={(v: string) => setFormData({...formData, telephone: v})} readOnly={isReadOnly} />
            </div>
          </Section>

          {/* Section 3: Bank Information */}
          <Section title="3. Bank Information" isActive={activeSection === 3} onToggle={() => setActiveSection(activeSection === 3 ? 0 : 3)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Beneficiary Account Name" required value={formData.beneficiaryAccountName} onChange={(v: string) => setFormData({...formData, beneficiaryAccountName: v})} readOnly={isReadOnly} />
              <Input label="Bank Account Number" required value={formData.bankAccountNumber} onChange={(v: string) => setFormData({...formData, bankAccountNumber: v})} readOnly={isReadOnly} />
              <Input label="Bank Name" required value={formData.bankName} onChange={(v: string) => setFormData({...formData, bankName: v})} readOnly={isReadOnly} />
              <Input label="Bank Branch Name" required value={formData.bankBranchName} onChange={(v: string) => setFormData({...formData, bankBranchName: v})} readOnly={isReadOnly} />
              <Input label="Bank RTGS/IFSC Code" required value={formData.bankIfscCode} onChange={(v: string) => setFormData({...formData, bankIfscCode: v})} readOnly={isReadOnly} />
              <Select label="Account Type" required value={formData.accountType} options={['Savings', 'Current', 'Other']} onChange={(v: string) => setFormData({...formData, accountType: v})} readOnly={isReadOnly} />
            </div>
          </Section>

          {/* Section 4: Tax Information */}
          <Section title="4. Tax Information" isActive={activeSection === 4} onToggle={() => setActiveSection(activeSection === 4 ? 0 : 4)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="PAN Number" required value={formData.panNumber} onChange={(v: string) => setFormData({...formData, panNumber: v})} readOnly={isReadOnly} />
              <Input label="GST Number" value={formData.gstNumber} onChange={(v: string) => setFormData({...formData, gstNumber: v})} readOnly={isReadOnly} />
              <Select label="Vendor Type" required value={formData.vendorType} options={['Manufacturer', 'Trader', 'Consultant', 'Service Provider']} onChange={(v: string) => setFormData({...formData, vendorType: v})} readOnly={isReadOnly} />
            </div>
          </Section>

          {/* Section 7: Documents Upload */}
          <Section title="7. Document Uploads" isActive={activeSection === 7} onToggle={() => setActiveSection(activeSection === 7 ? 0 : 7)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FileUpload label="PAN Scan PDF Copy" docKey="panScan" formData={formData} onChange={handleFileChange} onRemove={handleRemoveFile} onView={(url: string, name: string) => { setViewerFile({ url, name }); setViewerOpen(true); }} isReadOnly={isReadOnly} />
              <FileUpload label="Cancelled Cheque PDF Copy" docKey="cancelledCheque" formData={formData} onChange={handleFileChange} onRemove={handleRemoveFile} onView={(url: string, name: string) => { setViewerFile({ url, name }); setViewerOpen(true); }} isReadOnly={isReadOnly} />
              <FileUpload label="GST Registration PDF" docKey="gstRegistration" formData={formData} onChange={handleFileChange} onRemove={handleRemoveFile} onView={(url: string, name: string) => { setViewerFile({ url, name }); setViewerOpen(true); }} isReadOnly={isReadOnly} />
              <FileUpload label="Company Registration / MSME PDF" docKey="msmeCert" formData={formData} onChange={handleFileChange} onRemove={handleRemoveFile} onView={(url: string, name: string) => { setViewerFile({ url, name }); setViewerOpen(true); }} isReadOnly={isReadOnly} />
              <FileUpload label="Company Logo (Image)" docKey="companyLogo" formData={formData} onChange={handleFileChange} onRemove={handleRemoveFile} onView={(url: string, name: string) => { setViewerFile({ url, name }); setViewerOpen(true); }} isReadOnly={isReadOnly} />
            </div>
          </Section>

          {/* Section 6: Declaration */}
          <div className="bg-surface border border-border rounded-xl p-6">
            <label className="flex items-start space-x-3 cursor-pointer">
              <input 
                type="checkbox" 
                className="mt-1 w-5 h-5 rounded border-border bg-background text-primary focus:ring-primary/50"
                checked={formData.declaration}
                onChange={e => setFormData({...formData, declaration: e.target.checked})}
                disabled={isReadOnly}
              />
              <span className="text-sm text-muted leading-relaxed">
                "We hereby certify that above mentioned details are correct. We further confirm that the said details can be used by Seal Logistics Forwarders Pvt. Ltd. for online remittance of funds. The responsibility of any delay in payment and additional processing charges due to incorrect details vest with us."
              </span>
            </label>
          </div>

              {!isReadOnly && (
                <div className="mt-8 flex justify-end gap-4">
                  {isEditingKyc && (
                    <button type="button" onClick={() => setIsEditingKyc(false)} className="px-6 py-3 bg-surface hover:bg-surface2 text-text font-bold rounded-xl transition-colors border border-border">
                      Cancel Update
                    </button>
                  )}
                  <button type="submit" disabled={submitting} className="px-8 py-3 bg-primary hover:bg-primary-dark text-white font-bold rounded-xl transition-all shadow-[0_10px_20px_rgba(79,172,254,0.2)] disabled:opacity-50 disabled:cursor-not-allowed">
                    {submitting ? 'Submitting...' : isEditingKyc ? 'Submit Update' : 'Submit KYC'}
                  </button>
                </div>
              )}
          </form>
          </>
        )}

        {activeMainTab === 'other' && (
          <div className="bg-surface rounded-2xl border border-border p-8 text-center flex flex-col items-center justify-center space-y-4">
            <Upload className="w-12 h-12 text-muted/50 mb-2" />
            <h2 className="text-xl font-bold text-text">Other Documents</h2>
            <p className="text-muted text-sm max-w-md">
              Upload additional files like vehicle registration, driver licenses, or company insurance policies here. 
            </p>
            
            <label className="px-6 py-2.5 mt-4 bg-surface2 hover:bg-surface border border-border text-text rounded-xl font-bold text-sm transition-colors cursor-pointer inline-block">
              {submitting ? 'Uploading...' : 'Upload New Document'}
              <input type="file" accept=".pdf,.jpeg,.jpg,.png" className="hidden" disabled={submitting} onChange={handleOtherFileChange} />
            </label>
            
            <div className="w-full mt-8 border-t border-border pt-8 text-left">
              <span className="text-muted text-xs uppercase tracking-widest font-bold">Uploaded Documents</span>
              
              {otherDocs.length === 0 ? (
                <div className="mt-4 text-center py-10 bg-background/50 border border-border border-dashed rounded-xl">
                  <p className="text-muted text-sm">No additional documents uploaded yet.</p>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {otherDocs.map((doc, idx) => (
                    <div key={idx} className="bg-surface2 border border-border rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText className="w-8 h-8 text-primary shrink-0" />
                        <div className="flex flex-col truncate">
                          <span className="text-sm font-bold text-text truncate">{doc.name}</span>
                          <button onClick={() => { setViewerFile({ url: doc.url, name: doc.name }); setViewerOpen(true); }} className="text-xs text-primary text-left hover:underline w-fit">View Document</button>
                        </div>
                      </div>
                      <button onClick={() => handleRemoveOtherDoc(idx)} className="text-red-500/70 hover:text-red-500 bg-red-500/10 p-2 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      <DocumentViewerModal 
        isOpen={viewerOpen} 
        onClose={() => setViewerOpen(false)} 
        fileUrl={viewerFile.url} 
        fileName={viewerFile.name} 
      />
    </div>
  )
}

function Section({ title, children, isActive, onToggle }: any) {
  return (
    <div className="bg-surface2 border border-border rounded-xl overflow-hidden transition-all duration-300">
      <button 
        type="button"
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between bg-surface hover:bg-surface2 transition-colors"
      >
        <h2 className="text-xl font-bold text-text">{title}</h2>
        {isActive ? <ChevronUp className="w-5 h-5 text-muted" /> : <ChevronDown className="w-5 h-5 text-muted" />}
      </button>
      {isActive && (
        <div className="p-6">
          {children}
        </div>
      )}
    </div>
  )
}

function Input({ label, required, type = "text", value, onChange, readOnly }: any) {
  return (
    <div className="flex flex-col">
      <label className="text-sm text-muted mb-1.5 font-medium">{label} {required && <span className="text-red-400">*</span>}</label>
      <input 
        type={type} 
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        className="px-4 py-2.5 bg-background border border-border rounded-lg text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors read-only:opacity-60"
      />
    </div>
  )
}

function Select({ label, required, options, value, onChange, readOnly }: any) {
  return (
    <div className="flex flex-col">
      <label className="text-sm text-muted mb-1.5 font-medium">{label} {required && <span className="text-red-400">*</span>}</label>
      <select 
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={readOnly}
        className="px-4 py-2.5 bg-background border border-border rounded-lg text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-60"
      >
        <option value="">Select...</option>
        {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function FileUpload({ label, docKey, formData, onChange, onRemove, onView, isReadOnly }: any) {
  const fileUrl = formData.docUrls?.[docKey]
  const fileName = formData.documents?.[docKey]?.name

  return (
    <div className="bg-background border border-border border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center">
      <Upload className="w-6 h-6 text-muted mb-2" />
      <span className="text-sm font-medium text-text mb-1">{label}</span>
      {fileUrl ? (
        <button type="button" onClick={() => onView(fileUrl, label)} className="text-xs text-primary font-bold hover:underline">View Uploaded Document</button>
      ) : fileName ? (
        <span className="text-xs text-green-400">{fileName}</span>
      ) : (
        <span className="text-xs text-muted">No file uploaded</span>
      )}
      
      {!isReadOnly && (
        <div className="mt-3 flex gap-2">
          <label className="px-4 py-1.5 bg-surface hover:bg-surface2 text-xs font-medium rounded-lg cursor-pointer transition-colors border border-border">
            Upload
            <input type="file" accept=".pdf,.jpeg,.jpg,.png" className="hidden" onChange={(e) => onChange(e, docKey)} />
          </label>
          {(fileUrl || fileName) && (
            <button 
              type="button" 
              onClick={() => onRemove(docKey)}
              className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-medium rounded-lg cursor-pointer transition-colors border border-red-500/20"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}
