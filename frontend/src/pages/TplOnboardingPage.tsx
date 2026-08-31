import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Building2, CheckCircle2, ChevronRight, UploadCloud, Plus, AlertCircle, Trash2, ShieldCheck, ArrowLeft, Loader2, Eye, X
} from 'lucide-react'
import { tplAPI } from '@/services/api'
import { Card } from '@/components/ui'
import clsx from 'clsx'
import toast from 'react-hot-toast'

function AutocompleteInput({ label, value, onChange, options, placeholder, className, labelClass }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [filtered, setFiltered] = useState(options);

  return (
    <div className="relative w-full">
      {label && <label className={labelClass || "text-xs font-bold text-muted mb-1 block"}>{label}</label>}
      <input 
        type="text" 
        value={value}
        onChange={e => {
          onChange(e.target.value);
          setFiltered(options.filter((o: string) => o.toLowerCase().includes(e.target.value.toLowerCase())));
          setIsOpen(true);
        }}
        onFocus={() => {
           setFiltered(options.filter((o: string) => o.toLowerCase().includes(value.toLowerCase())));
           setIsOpen(true);
        }}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        className={className}
        placeholder={placeholder}
      />
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-md shadow-xl max-h-48 overflow-y-auto animate-fade-in origin-top text-left">
          {filtered.map((opt: string) => (
            <div 
              key={opt}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setIsOpen(false);
              }}
              className="px-4 py-2.5 text-sm text-text font-bold hover:bg-primary hover:text-bg cursor-pointer border-b border-border/50 last:border-0 transition-colors"
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TplOnboardingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const editPan = searchParams.get('pan')
  
  const [step, setStep] = useState(1)
  const [isLoadingExisting, setIsLoadingExisting] = useState(!!editId)
  
  // Step 1 State (KYC)
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [pan, setPan] = useState('')
  const [gst, setGst] = useState('')
  const [msmeStatus, setMsmeStatus] = useState('Not Registered')
  const [bankAccount, setBankAccount] = useState('')
  const [bankIfsc, setBankIfsc] = useState('')
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, File>>({})
  const [previewFile, setPreviewFile] = useState<{file: File, url: string, name: string} | null>(null)
  
  // Step 3 State (Success)
  const [trackingId, setTrackingId] = useState<string>('')

  // Step 2 State (Ops)
  const [corridors, setCorridors] = useState([{ id: 1, name: '', vehicles: '', rate: '', priority: '1' }])
  const [isDeclared, setIsDeclared] = useState(false)
  const [slaCommitment, setSlaCommitment] = useState('2 Hours')
  const [taxTreatment, setTaxTreatment] = useState('12% GTA (With ITC) - Forward Charge')

  // Pre-defined recommendation lists
  const COMPANY_RECOMMENDATIONS = [
    // Logistics
    "Safexpress Pvt Ltd", "Delhivery MSME", "Blue Dart Express", "VRL Logistics", "TCI Freight",
    // Food & Beverage / Retail
    "Cafe Coffee Day", "Haldiram's", "Bikano", "Reliance Retail", "Tata Starbucks", "D-Mart", "Shoppers Stop",
    // Manufacturing / Auto
    "Tata Motors", "Mahindra & Mahindra", "Bajaj Auto", "Maruti Suzuki", "Hero MotoCorp", "Asian Paints",
    // FMCG
    "Hindustan Unilever", "ITC Limited", "Britannia Industries", "Parle Products", "Patanjali Ayurved", "Dabur India",
    // IT / Tech / Services
    "Infosys", "Wipro", "TCS", "Tech Mahindra", "HCL Technologies", "Paytm", "Zomato",
    // Pharma / Healthcare
    "Sun Pharmaceutical", "Cipla", "Dr. Reddy's Laboratories", "Apollo Hospitals", "Lupin"
  ];

  const CORRIDOR_RECOMMENDATIONS = [
    "DEL-BOM", "BOM-BLR", "DEL-BLR", "BLR-CHE", "CHE-HYD", 
    "DEL-HYD", "PUN-HYD", "BOM-PUN", "DEL-CCU", "CCU-BOM",
    "CCU-BLR", "AMD-BOM", "DEL-AMD", "HYD-BLR", "DEL-LKO"
  ];

  const VEHICLE_RECOMMENDATIONS = [
    "32ft SXL", "32ft MXL", "24ft SXL", "20ft", "14ft Eicher", 
    "17ft Eicher", "19ft Eicher", "Tata Ace", "Ashok Leyland Dost",
    "Bolero Pickup", "40ft Trailer", "40ft Flatbed", "Refrigerated Van"
  ];

  const handleNext = () => {
    if (step === 1) {
      if (!companyName || !pan || !gst || !email) {
        toast.error('Please fill in required fields (Company, Email, PAN, GST).');
        return;
      }
      
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(pan)) {
        toast.error('Invalid PAN Format. Example: ABCDE1234F');
        return;
      }

      const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstRegex.test(gst)) {
        toast.error('Invalid GSTIN Format. Example: 07ABCDE1234F1Z5');
        return;
      }

      setStep(2);
    }
  }

  const addCorridor = () => setCorridors([...corridors, { id: Date.now(), name: '', vehicles: '', rate: '', priority: '1' }])
  
  const removeCorridor = (id: number) => {
    setCorridors(corridors.filter(c => c.id !== id))
  }

  // Pre-fill form if editing
  useEffect(() => {
    if (!editId || !editPan) return;
    
    tplAPI.getPartner(editId).then(data => {
        if (data.pan_number === editPan.toUpperCase()) {
          setCompanyName(data.company_name || '')
          setPan(data.pan_number || '')
          setGst(data.gstin || '')
          setMsmeStatus(data.msme_status || '')
          setBankAccount(data.bank_account_no || '')
          setBankIfsc(data.bank_ifsc || '')
          setSlaCommitment(data.sla_commitment || '2 Hours')
          setTaxTreatment(data.tax_treatment || 'Standard')
          
          if (data.tpl_corridors && data.tpl_corridors.length > 0) {
            setCorridors(data.tpl_corridors.map((c: any, i: number) => ({
              id: i + 1,
              name: c.corridor_name,
              vehicles: (c.vehicle_types || []).join(', '),
              rate: c.proposed_rate || '',
              priority: c.priority || '1'
            })))
          }
        } else {
          toast.error('Invalid credentials for editing this application.')
          navigate('/3pl/onboard/track')
        }
      }).catch(err => {
        toast.error('Failed to load application data.')
      }).finally(() => {
        setIsLoadingExisting(false)
      })
  }, [editId, editPan, navigate])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, docName: string) => {
    const file = e.target.files?.[0];
    if (file && file.size > 2 * 1024 * 1024) {
      toast.error(`File ${file.name} exceeds 2MB limit`);
      e.target.value = '';
    } else if (file) {
      setUploadedDocs(prev => ({ ...prev, [docName]: file }));
      toast.success(`${file.name} attached successfully`);
    }
  };

  return (
    <div className="min-h-screen bg-bg py-12 px-4 animate-fade-in">
      <div className="max-w-4xl mx-auto space-y-8 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        
        {/* Top Navigation */}
        <div className="absolute top-6 right-6">
          <button 
            onClick={() => navigate('/')} 
            className="text-sm font-bold uppercase tracking-widest text-muted hover:text-primary transition-colors flex items-center gap-2"
          >
            Go to Main Page
          </button>
        </div>

        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <Building2 size={32} />
          </div>
          <h1 className="font-display text-4xl font-black tracking-tighter text-text uppercase leading-none">
            MargixIndia <span className="text-primary">Partner Setup</span>
          </h1>
          <div className="text-muted font-bold tracking-tight mt-4 text-sm max-w-lg mx-auto">
            You've been invited to join the MargixIndia Tier 2 Cascade Network. Please provide your business identity and operational terms below.
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-4 border-b border-border pb-6 max-w-2xl mx-auto">
           <div className={clsx("flex items-center gap-2 text-sm font-black uppercase tracking-widest transition-colors", step === 1 ? 'text-primary' : 'text-green-500')}>
             <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-bg", step === 1 ? 'bg-primary' : 'bg-green-500')}>
               {step === 1 ? '1' : <CheckCircle2 size={14} />}
             </div>
             Identity & KYC
           </div>
           <div className="flex-1 h-px bg-border" />
           <div className={clsx("flex items-center gap-2 text-sm font-black uppercase tracking-widest transition-colors", step === 2 ? 'text-primary' : 'text-muted')}>
             <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-bg border", step === 2 ? 'bg-primary border-primary' : 'bg-surface2 border-border text-muted')}>
               2
             </div>
             Operational Profile
           </div>
        </div>

        {/* STEP 1: KYC */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
             <Card className="p-8 border-border bg-surface shadow-2xl">
                <div className="flex items-center gap-3 mb-6 border-b border-border pb-4">
                  <ShieldCheck size={24} className="text-primary" />
                  <h2 className="text-xl font-black text-text uppercase">Company Identity</h2>
                </div>

                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       <AutocompleteInput
                         label="Company Legal Name *"
                         value={companyName}
                         onChange={(val: string) => setCompanyName(val)}
                         options={COMPANY_RECOMMENDATIONS}
                         placeholder="e.g. Safexpress Pvt Ltd"
                         className="w-full bg-surface border border-border rounded text-text font-medium text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm transition-all"
                       />
                       <div>
                         <label className="text-xs font-bold text-muted mb-1 block">Contact Email *</label>
                         <input
                           type="email"
                           value={email}
                           onChange={e => setEmail(e.target.value)}
                           className="w-full bg-surface border border-border rounded text-text font-medium text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm transition-all"
                           placeholder="admin@safexpress.com"
                         />
                       </div>
                       <div>
                         <label className="text-xs font-bold text-muted mb-1 block">Company PAN *</label>
                         <input
                           type="text"
                           value={pan}
                           onChange={e => setPan(e.target.value.toUpperCase())}
                           className="w-full bg-surface border border-border rounded text-text font-mono text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm transition-all uppercase"
                           placeholder="ABCDE1234F"
                         />
                       </div>
                       <div>
                         <label className="text-xs font-bold text-muted mb-1 block">GSTIN *</label>
                         <input
                           type="text"
                           value={gst}
                           onChange={e => setGst(e.target.value.toUpperCase())}
                           className="w-full bg-surface border border-border rounded text-text font-mono text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm transition-all uppercase"
                           placeholder="07ABCDE1234F1Z5"
                         />
                       </div>
                       <div>
                         <label className="text-xs font-bold text-muted mb-1 block">MSME Status</label>
                         <select 
                           value={msmeStatus}
                           onChange={e => setMsmeStatus(e.target.value)}
                           className="w-full bg-surface border border-border rounded text-text font-medium text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm transition-all"
                         >
                           <option>Not Registered</option>
                           <option>Micro</option>
                           <option>Small</option>
                           <option>Medium</option>
                         </select>
                       </div>
                    </div>

                    <div className="pt-6 border-t border-border mt-6">
                      <h3 className="text-xs font-bold text-text mb-4">Bank Details (For Remittance)</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div>
                           <label className="text-xs font-bold text-muted mb-1 block">Account No.</label>
                           <input 
                             type="text" 
                             value={bankAccount}
                             onChange={e => setBankAccount(e.target.value)}
                             className="w-full bg-surface border border-border rounded text-text font-mono text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm transition-all" 
                           />
                         </div>
                         <div>
                           <label className="text-xs font-bold text-muted mb-1 block">IFSC Code</label>
                           <input 
                             type="text" 
                             value={bankIfsc}
                             onChange={e => setBankIfsc(e.target.value.toUpperCase())}
                             className="w-full bg-surface border border-border rounded text-text font-mono text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm transition-all uppercase" 
                           />
                         </div>
                      </div></div>
                </div>
             </Card>

             <div className="flex justify-end pt-4">
                <button 
                  onClick={handleNext}
                  className="px-8 py-3 bg-primary text-bg font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center gap-2 hover:bg-primary-dark"
                >
                   Next: Operational Profile <ChevronRight size={16} />
                </button>
             </div>
          </div>
        )}

        {/* STEP 2: Ops */}
        {step === 2 && (
          <div className="space-y-6 animate-fade-in">
             <Card className="p-8 border-border bg-surface shadow-2xl">
                <div className="flex items-center gap-3 mb-6 border-b border-border pb-4">
                  <CheckCircle2 size={24} className="text-primary" />
                  <h2 className="text-xl font-black text-text uppercase">Operational Profile</h2>
                </div>

                <div className="space-y-8">
                   {/* SLA & Tax Options */}
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-8 border-b border-border">
                      <div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">Default SLA Commitment</label>
                        <select 
                          value={slaCommitment}
                          onChange={e => setSlaCommitment(e.target.value)}
                          className="w-full p-3 bg-bg border border-border rounded-xl text-sm focus:outline-none focus:border-primary text-text font-bold"
                        >
                          <option>2 Hours</option>
                          <option>4 Hours</option>
                          <option>6 Hours</option>
                          <option>12 Hours</option>
                        </select>
                        <p className="text-[10px] text-muted font-bold mt-2">Max time to respond to a broadcast request.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">GTA Tax Treatment</label>
                        <select 
                          value={taxTreatment}
                          onChange={e => setTaxTreatment(e.target.value)}
                          className="w-full p-3 bg-bg border border-border rounded-xl text-sm focus:outline-none focus:border-primary text-text font-bold"
                        >
                          <option>12% GTA (With ITC) - Forward Charge</option>
                          <option>5% GTA (No ITC) - Reverse Charge</option>
                        </select>
                        <p className="text-[10px] text-yellow-500 font-bold mt-2 flex items-center gap-1">
                          <AlertCircle size={12}/> Determines reverse charge liability on your invoices.
                        </p>
                      </div>
                   </div>

                   {/* Corridor Configurations */}
                   <div>
                      <div className="flex justify-between items-center mb-4">
                        <label className="text-xs font-bold text-muted uppercase tracking-widest">Corridor & Rate Declarations</label>
                        <button onClick={addCorridor} className="text-[10px] text-primary hover:underline font-black uppercase flex items-center gap-1">
                          <Plus size={14} /> Add Corridor
                        </button>
                      </div>

                      <div className="space-y-4">
                        {corridors.map((c, idx) => (
                          <div key={c.id} className="p-4 bg-bg border border-border rounded-xl relative group">
                            {corridors.length > 1 && (
                              <button onClick={() => removeCorridor(c.id)} className="absolute -right-2 -top-2 w-6 h-6 bg-red-500 text-bg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                                <Trash2 size={12} />
                              </button>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                               <AutocompleteInput
                                 label="Corridor (e.g. DEL-BOM)"
                                 labelClass="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1"
                                 value={c.name}
                                 onChange={(val: string) => {
                                   const newC = [...corridors];
                                   newC[idx].name = val.toUpperCase();
                                   setCorridors(newC);
                                 }}
                                 options={CORRIDOR_RECOMMENDATIONS}
                                 className="w-full p-2.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-bold uppercase"
                               />
                               <AutocompleteInput
                                 label="Vehicle Types"
                                 labelClass="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1"
                                 value={c.vehicles}
                                 onChange={(val: string) => {
                                   const newC = [...corridors];
                                   newC[idx].vehicles = val;
                                   setCorridors(newC);
                                 }}
                                 options={VEHICLE_RECOMMENDATIONS}
                                 placeholder="e.g. 32ft SXL, 20ft"
                                 className="w-full p-2.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-bold"
                               />
                               <div>
                                 <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Proposed Rate</label>
                                 <input 
                                   type="text" 
                                   value={c.rate}
                                   onChange={e => {
                                     const newC = [...corridors];
                                     newC[idx].rate = e.target.value;
                                     setCorridors(newC);
                                   }}
                                   placeholder="e.g. Base + 12%" 
                                   className="w-full p-2.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono" 
                                 />
                               </div>
                               <div>
                                 <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Requested Priority</label>
                                 <select 
                                   value={c.priority}
                                   onChange={e => {
                                     const newC = [...corridors];
                                     newC[idx].priority = e.target.value;
                                     setCorridors(newC);
                                   }}
                                   className="w-full p-2.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-bold"
                                 >
                                   <option>Priority 1 (First)</option>
                                   <option>Priority 2</option>
                                   <option>Priority 3 (Backup)</option>
                                 </select>
                               </div>
                            </div>
                          </div>
                        ))}
                      </div>
                   </div>

                   {/* Document Upload */}
                   <div className="pt-8 border-t border-border">
                      <div className="flex items-center justify-between mb-4">
                        <label className="block text-xs font-bold text-muted">KYC & Commercial Documents</label>
                        <span className="text-[10px] text-muted font-mono">Max file size: 2MB</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                         {['PAN Card', 'GST Certificate', 'Cancelled Cheque', 'Signed Rate Agreement'].map((docName, idx) => {
                           const uploadedFile = uploadedDocs[docName];
                           return (
                             <label key={idx} className={clsx("border border-dashed rounded p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors shadow-sm h-28 overflow-hidden", uploadedFile ? "border-green-500 bg-green-500/5 hover:bg-green-500/10" : "border-border bg-surface hover:border-primary hover:bg-primary/5")}>
                                {uploadedFile ? (
                                  <div className="flex flex-col items-center justify-center w-full h-full relative group">
                                    <CheckCircle2 size={24} className="text-green-500 mb-1" />
                                    <div className="text-xs font-bold text-green-600 mb-1 truncate w-full px-2 text-center">{docName}</div>
                                    <div className="text-[10px] text-muted truncate w-full px-2 text-center" title={uploadedFile.name}>{uploadedFile.name}</div>
                                    
                                     <div className="absolute inset-0 bg-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[1px] gap-2 rounded">
                                        <button 
                                          onClick={(e) => {
                                             e.preventDefault();
                                             e.stopPropagation();
                                             setPreviewFile({
                                               file: uploadedFile, 
                                               url: URL.createObjectURL(uploadedFile),
                                               name: docName
                                             });
                                          }}
                                          className="p-1.5 bg-white border border-border/50 rounded shadow-sm text-primary hover:bg-primary hover:text-bg transition-colors"
                                          title="View Document"
                                        >
                                          <Eye size={16} />
                                        </button>
                                        <button 
                                          onClick={(e) => {
                                             e.preventDefault();
                                             e.stopPropagation();
                                             const newDocs = {...uploadedDocs};
                                             delete newDocs[docName];
                                             setUploadedDocs(newDocs);
                                          }}
                                          className="p-1.5 bg-white border border-border/50 rounded shadow-sm text-red-500 hover:bg-red-500 hover:text-bg transition-colors"
                                          title="Remove Document"
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                     </div>
                                  </div>
                                ) : (
                                  <>
                                    <UploadCloud size={24} className="text-muted mb-2" />
                                    <div className="text-xs font-bold text-text">{docName}</div>
                                  </>
                                )}
                                <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={e => handleFileUpload(e, docName)} />
                             </label>
                           );
                         })}
                      </div>
                   </div>

                   <div className="pt-6">
                     <div className="flex items-start gap-3 p-4 bg-surface2 rounded-xl border border-border">
                       <input 
                         type="checkbox" 
                         checked={isDeclared}
                         onChange={e => setIsDeclared(e.target.checked)}
                         className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-primary bg-bg cursor-pointer" 
                         id="declare" 
                       />
                       <label htmlFor="declare" className="text-xs text-muted font-medium cursor-pointer">
                         I hereby declare that the information provided is accurate and complete. I understand that this operational profile is subject to approval by the Super Admin before my account is activated for the Tier 2 cascade.
                       </label>
                     </div>
                   </div>

                </div>
             </Card>

             <div className="flex justify-between items-center pt-4">
                <button onClick={() => setStep(1)} className="px-6 py-3 text-muted hover:text-text font-bold text-sm transition-colors flex items-center gap-2">
                   <ArrowLeft size={16} /> Back
                </button>
                <button 
                  disabled={!isDeclared}
                  onClick={async () => {
                    try {
                      const payload = {
                        companyName, email, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors,
                        documents: Object.keys(uploadedDocs).map(docType => ({ type: docType, url: uploadedDocs[docType].name }))
                      };
                      
                      const promise = editId 
                        ? tplAPI.updateApplication(editId, payload)
                        : tplAPI.onboard(payload);

                      const data = await toast.promise(promise, {
                          loading: editId ? 'Updating application...' : 'Submitting application...',
                          success: editId ? 'Application Updated!' : 'Application Submitted!',
                          error: editId ? 'Failed to update application.' : 'Failed to submit application.'
                      })
                      setTrackingId(editId || data.id)
                      setStep(3)
                    } catch (e) {
                      console.error(e)
                    }
                  }}
                  className={clsx("px-8 py-3 font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-lg flex items-center gap-2", 
                    isDeclared 
                      ? "bg-primary text-bg hover:bg-primary-dark shadow-primary/20" 
                      : "bg-surface2 text-muted border border-border cursor-not-allowed opacity-70"
                  )}
                >
                   Submit Application <CheckCircle2 size={16} />
                </button>
             </div>
          </div>
        )}

        {/* STEP 3: Success Mock */}
        {step === 3 && (
          <div className="py-24 flex flex-col items-center justify-center text-center animate-fade-in bg-surface border border-border rounded-3xl shadow-2xl">
             <div className="w-24 h-24 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mb-8 border border-green-500/20">
               <CheckCircle2 size={48} />
             </div>
             <h2 className="text-3xl font-black uppercase tracking-tight text-text">
               {editId ? 'Application Updated' : 'Application Submitted'}
             </h2>
             <p className="text-sm text-muted font-medium mt-4 max-w-lg leading-relaxed">
               {editId 
                 ? 'Your updated identity and operational terms have been securely transmitted to the Super Admin.'
                 : 'Your identity and operational terms have been securely transmitted to the Super Admin for review.'
               }
             </p>
             <div className="mt-8 p-6 bg-surface2 border border-border rounded-xl max-w-md w-full">
               <p className="text-xs text-muted font-bold text-center">
                 <strong className="text-text uppercase tracking-widest text-[10px] block mb-2">Your Application Tracking ID</strong>
                 <span className="text-sm font-mono font-black text-primary bg-primary/10 px-4 py-2 rounded-lg block my-3 tracking-widest select-all">
                   {trackingId || 'APP-XXXX'}
                 </span>
                 Please save this tracking ID. You can use it along with your PAN number to check your status or edit your application before it is approved.
               </p>
             </div>
             
             <button 
               onClick={() => navigate('/3pl/onboard/track')}
               className="mt-8 px-6 py-3 bg-surface border border-border hover:border-primary text-text font-bold uppercase tracking-widest text-sm rounded-xl transition-colors shadow-sm"
             >
               Track My Application
             </button>
          </div>
        )}
      </div>

      {/* File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-in">
            <div className="p-4 border-b border-border flex justify-between items-center bg-surface2">
              <div>
                <h3 className="font-black text-text">{previewFile.name}</h3>
                <p className="text-xs font-mono text-muted">{previewFile.file.name}</p>
              </div>
              <button 
                onClick={() => setPreviewFile(null)} 
                className="p-2 hover:bg-black/5 rounded-full text-muted hover:text-text transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-black/5 p-4 flex items-center justify-center">
              {previewFile.file.type.startsWith('image/') ? (
                <img src={previewFile.url} alt="Preview" className="max-w-full max-h-full object-contain shadow-lg rounded" />
              ) : (
                <iframe src={previewFile.url} className="w-full h-[70vh] rounded bg-white shadow-lg border-0" title="PDF Preview" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
