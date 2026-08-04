import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, FileText, CheckCircle, XCircle, Search, User, Eye, Download } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { Card, Badge, Button, Spinner } from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import toast from 'react-hot-toast'

export default function AdminKycReview() {
  const queryClient = useQueryClient()
  const [selectedVendor, setSelectedVendor] = useState<any>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerFile, setViewerFile] = useState({ url: '', name: '' })
  
  const { data: vendors = [], isLoading } = useQuery<any[]>({
    queryKey: ['kyc-vendors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_profiles')
        .select('*')
      if (error) throw error
      
      // Parse dummy2
      return data.map(v => {
        let kycStatus = 'pending'
        let kycData = null
        if (v.dummy2) {
          try {
            const parsed = typeof v.dummy2 === 'string' ? JSON.parse(v.dummy2) : v.dummy2
            kycStatus = parsed.status || 'pending'
            kycData = parsed.data || null
          } catch(e) {}
        }
        return { ...v, kycStatus, kycData }
      }).sort((a, b) => {
        // Sort submitted first
        if (a.kycStatus === 'submitted' && b.kycStatus !== 'submitted') return -1
        if (a.kycStatus !== 'submitted' && b.kycStatus === 'submitted') return 1
        return 0
      })
    }
  })

  const updateKycMutation = useMutation({
    mutationFn: async ({ id, status, currentData }: any) => {
      const payload = {
        status,
        data: currentData
      }
      const { error } = await supabase
        .from('vendor_profiles')
        .update({ dummy2: JSON.stringify(payload) })
        .eq('id', id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyc-vendors'] })
      setSelectedVendor(null)
      toast.success('KYC Status Updated')
    },
    onError: (err: any) => toast.error(err.message)
  })

  if (selectedVendor) {
    const kData = selectedVendor.kycData || {}
    const isSubmitted = selectedVendor.kycStatus === 'submitted'
    
    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedVendor(null)} className="text-sm text-primary hover:underline mb-4">
          &larr; Back to KYC List
        </button>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-text">KYC Review: {kData.name || selectedVendor.company_name}</h2>
          <div className="flex space-x-3">
            <button 
              onClick={() => updateKycMutation.mutate({ id: selectedVendor.id, status: 'rejected', currentData: kData })}
              disabled={updateKycMutation.isPending || !isSubmitted}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-50"
            >
              Reject
            </button>
            <button 
              onClick={() => updateKycMutation.mutate({ id: selectedVendor.id, status: 'approved', currentData: kData })}
              disabled={updateKycMutation.isPending || !isSubmitted}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
        
        <Card className="p-6 bg-surface2 border-border">
          <h3 className="font-bold text-lg text-text mb-4 border-b border-border pb-2">Basic Info</h3>
          <div className="grid grid-cols-2 gap-4 text-sm text-muted">
            <div><span className="text-muted">Name:</span> {kData.name}</div>
            <div><span className="text-muted">Vendor Number:</span> {kData.number}</div>
            <div><span className="text-muted">Country:</span> {kData.country}</div>
            <div><span className="text-muted">Address:</span> {kData.addressLine1} {kData.city}, {kData.state} {kData.postalCode}</div>
          </div>
          
          <h3 className="font-bold text-lg text-text mt-8 mb-4 border-b border-border pb-2">Contact</h3>
          <div className="grid grid-cols-2 gap-4 text-sm text-muted">
            <div><span className="text-muted">Person:</span> {kData.contactPerson}</div>
            <div><span className="text-muted">Email:</span> {kData.emailAddress}</div>
            <div><span className="text-muted">Mobile:</span> {kData.mobileNumber}</div>
            <div><span className="text-muted">Telephone:</span> {kData.telephone}</div>
          </div>
          
          <h3 className="font-bold text-lg text-text mt-8 mb-4 border-b border-border pb-2">Bank & Tax</h3>
          <div className="grid grid-cols-2 gap-4 text-sm text-muted">
            <div><span className="text-muted">Bank Name:</span> {kData.bankName} ({kData.bankBranchName})</div>
            <div><span className="text-muted">Account No:</span> {kData.bankAccountNumber}</div>
            <div><span className="text-muted">IFSC:</span> {kData.bankIfscCode}</div>
            <div><span className="text-muted">PAN:</span> {kData.panNumber}</div>
            <div><span className="text-muted">GST:</span> {kData.gstNumber}</div>
            <div><span className="text-muted">HSN:</span> {kData.hsnCode}</div>
          </div>
          
          <h3 className="font-bold text-lg text-text mt-8 mb-4 border-b border-border pb-2">Documents</h3>
          <div className="flex flex-col space-y-3">
            {kData.docUrls ? Object.entries(kData.docUrls).map(([k, v]: any) => (
              <button 
                key={k} 
                onClick={() => { setViewerFile({ url: v, name: k }); setViewerOpen(true); }} 
                className="text-primary hover:underline flex items-center text-sm w-fit"
              >
                <FileText size={14} className="mr-2" /> View {k}
              </button>
            )) : <span className="text-muted text-sm">No documents uploaded.</span>}
          </div>
        </Card>

        <DocumentViewerModal 
          isOpen={viewerOpen} 
          onClose={() => setViewerOpen(false)} 
          fileUrl={viewerFile.url} 
          fileName={viewerFile.name} 
        />
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            {['Vendor', 'Status', 'Submitted At', 'Actions'].map(h => (
              <th key={h} className="px-6 py-4 text-left text-[10px] font-bold text-muted uppercase tracking-widest">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={4} className="py-20 text-center"><Spinner size={32} /></td></tr>
          ) : vendors.length === 0 ? (
            <tr><td colSpan={4} className="py-20 text-center text-muted text-xs">No vendors found</td></tr>
          ) : (
            vendors.map((v: any) => (
              <tr key={v.id} className="border-b border-border hover:bg-white/[0.02] transition-colors">
                <td className="px-6 py-4 text-sm font-bold text-text">
                  {v.company_name || 'Unknown Vendor'}
                  <div className="text-xs text-muted font-normal font-mono">{v.gst_number || 'No GST'}</div>
                </td>
                <td className="px-6 py-4">
                  {v.kycStatus === 'approved' && <Badge variant="green">Approved</Badge>}
                  {v.kycStatus === 'submitted' && <Badge variant="warn">Action Needed</Badge>}
                  {v.kycStatus === 'pending' && <Badge variant="muted">Pending</Badge>}
                  {v.kycStatus === 'rejected' && <Badge variant="orange">Rejected</Badge>}
                </td>
                <td className="px-6 py-4 text-sm text-muted font-mono">
                  {new Date(v.updated_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <Button size="sm" variant="accent" onClick={() => setSelectedVendor(v)}>
                    <Eye size={14} className="mr-2" /> Review
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
