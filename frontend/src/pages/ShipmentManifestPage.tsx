import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import { 
  ArrowLeft, Edit3, Save, X, FileText, Package, User, 
  MapPin, Clock, Calendar, ShieldCheck, Box, Truck,
  AlertTriangle, Navigation, Loader2
} from 'lucide-react';
import { shipmentsAPI } from '@/services/api';
import { formatEta } from '@/utils/timeFormat';

export default function ShipmentManifestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const token = useAuthStore(s => s.token);
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<any>(null);

  const { data: shipment, isLoading, isError } = useQuery({
    queryKey: ['shipment', id],
    queryFn: () => shipmentsAPI.get(id!),
    enabled: !!id && !!token,
  });

  // Initialize edit form when data loads
  useEffect(() => {
    if (shipment?.metadata) {
      setEditData(shipment.metadata);
    }
  }, [shipment, isEditing]);

  const updateMutation = useMutation({
    mutationFn: async (updatedMetadata: any) => {
      const res = await axios.put(`/api/v1/shipments/${id}/metadata`, updatedMetadata, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Manifest updated successfully');
      queryClient.invalidateQueries({ queryKey: ['shipment', id] });
      setIsEditing(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Failed to update manifest');
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center">
        <Loader2 className="animate-spin text-primary w-12 h-12" />
      </div>
    );
  }

  if (isError || !shipment) {
    return (
      <div className="p-8">
        <div className="bg-red-50 text-red-500 p-4 rounded-xl border border-red-200">
          Failed to load shipment details. Please try again later.
        </div>
        <button onClick={() => navigate(-1)} className="mt-4 flex items-center gap-2 text-text/60 hover:text-text">
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    );
  }

  const meta = isEditing ? editData : (shipment.metadata || {});

  const handleInputChange = (field: string, value: any) => {
    setEditData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleCheckboxChange = (field: string) => {
    setEditData((prev: any) => ({
      ...prev,
      specialHandling: {
        ...prev.specialHandling,
        [field]: !prev.specialHandling?.[field]
      }
    }));
  };

  const handleSave = () => {
    updateMutation.mutate(editData);
  };

  const renderField = (label: string, value: any, fieldKey: string, type = 'text', width = 'w-full') => {
    if (isEditing) {
      return (
        <div className={`flex flex-col gap-1 ${width}`}>
          <label className="text-[10px] font-bold text-text/40 uppercase tracking-wider">{label}</label>
          <input 
            type={type}
            value={value || ''}
            onChange={(e) => handleInputChange(fieldKey, e.target.value)}
            className="w-full bg-white border border-black/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
      );
    }
    
    return (
      <div className={`flex flex-col gap-1 ${width}`}>
        <label className="text-[10px] font-bold text-text/40 uppercase tracking-wider">{label}</label>
        <div className="text-sm font-semibold text-text truncate">
          {value || <span className="text-text/30 italic">Not specified</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] p-6 lg:p-12 font-sans pb-32">
      
      {/* Header */}
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <button 
            onClick={() => navigate('/shipments')} 
            className="flex items-center gap-2 text-text/50 hover:text-text mb-4 transition-colors font-medium text-sm"
          >
            <ArrowLeft size={16} /> Back to Cargo Manifest
          </button>
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-black text-text uppercase tracking-tight">Cargo Manifest</h1>
            <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-bold uppercase rounded-md tracking-wider">
              {shipment.tracking_id}
            </span>
          </div>
          <p className="text-text/50 text-sm mt-1">Detailed operational parameters for shipment ID: {shipment.id}</p>
        </div>

        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <button 
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-black/5 text-text hover:bg-black/10 transition-colors"
                disabled={updateMutation.isPending}
              >
                <X size={16} /> Cancel
              </button>
              <button 
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-primary text-white hover:bg-primary/90 transition-all shadow-[0_4px_14px_0_rgba(252,211,77,0.39)]"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <Save size={16} />}
                Save Changes
              </button>
            </>
          ) : (
            <button 
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-black text-white hover:bg-black/80 transition-colors shadow-lg shadow-black/10"
            >
              <Edit3 size={16} /> Edit Manifest
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column - Logistics & Routing */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          
          <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-500">
                <Navigation size={20} />
              </div>
              <div>
                <h2 className="font-black text-lg">Routing Logistics</h2>
                <p className="text-[10px] text-text/50 font-bold uppercase tracking-wider">System Generated</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="mt-1"><MapPin size={16} className="text-blue-500" /></div>
                <div>
                  <label className="text-[10px] font-bold text-text/40 uppercase tracking-wider">Origin (Consignor)</label>
                  <p className="text-sm font-bold text-text">{shipment.pickup_location?.address}</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="mt-1"><MapPin size={16} className="text-rose-500" /></div>
                <div>
                  <label className="text-[10px] font-bold text-text/40 uppercase tracking-wider">Destination (Consignee)</label>
                  <p className="text-sm font-bold text-text">{shipment.drop_location?.address}</p>
                </div>
              </div>

              <div className="h-px bg-black/5 w-full my-4" />

              {renderField('Dispatch Date', meta.dispatch_date, 'dispatch_date', 'date')}
              {renderField('Reporting Date', meta.reporting_date, 'reporting_date', 'date')}
              {renderField('Estimated Time (ETA)', meta.eta_details?.eta_text, 'eta_details.eta_text')}
              
              <div className="flex items-center justify-between bg-black/5 p-4 rounded-2xl">
                <div>
                  <label className="text-[10px] font-bold text-text/40 uppercase tracking-wider">Distance</label>
                  <p className="font-bold text-text">{meta.eta_details?.distance_km} KM</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-text/40 uppercase tracking-wider">Long Haul Flag</label>
                  <p className={`font-bold ${meta.is_long_haul ? 'text-amber-500' : 'text-emerald-500'}`}>
                    {meta.is_long_haul ? 'YES' : 'NO'}
                  </p>
                </div>
              </div>

            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500">
                <User size={20} />
              </div>
              <h2 className="font-black text-lg">Consignee Details</h2>
            </div>
            
            <div className="space-y-4">
              {renderField('Full Name', meta.consigneeName, 'consigneeName')}
              {renderField('Contact Number', meta.consigneeContact, 'consigneeContact')}
              {renderField('Email Address', meta.consigneeEmail, 'consigneeEmail', 'email')}
            </div>
          </div>
          
        </div>

        {/* Right Column - Cargo Specs */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-500">
                <Package size={20} />
              </div>
              <h2 className="font-black text-lg">Product Information</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {renderField('Product Category', meta.productCategory, 'productCategory')}
              {renderField('Product Name', meta.productName, 'productName')}
              {renderField('Brand', meta.brand, 'brand')}
              {renderField('Model / Variant', meta.modelVariant, 'modelVariant')}
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-500">
                <Box size={20} />
              </div>
              <h2 className="font-black text-lg">Packaging & Quantity</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-6">
              {renderField('Packaging Type', meta.packagingType, 'packagingType')}
              {renderField('No. of Packages', meta.noOfPackages, 'noOfPackages', 'number')}
              {renderField('Quantity', meta.quantity, 'quantity', 'number')}
              {renderField('Unit', meta.unit, 'unit')}
              {renderField('Gross Weight', meta.grossWeight, 'grossWeight')}
              {renderField('Declared Value (₹)', meta.declaredValue, 'declaredValue')}
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500">
                <ShieldCheck size={20} />
              </div>
              <h2 className="font-black text-lg">Special Handling</h2>
            </div>

            <div className="flex flex-wrap gap-4 mb-8">
              {[
                { key: 'fragile', label: 'Fragile', color: 'rose' },
                { key: 'hazardous', label: 'Hazardous', color: 'amber' },
                { key: 'coldChain', label: 'Cold Chain', color: 'blue' },
                { key: 'stackable', label: 'Stackable', color: 'emerald' },
                { key: 'highValue', label: 'High Value', color: 'purple' },
              ].map(item => (
                <div 
                  key={item.key}
                  onClick={() => isEditing && handleCheckboxChange(item.key)}
                  className={`
                    flex items-center gap-3 px-5 py-3 rounded-2xl border-2 transition-all
                    ${isEditing ? 'cursor-pointer' : 'cursor-default'}
                    ${meta.specialHandling?.[item.key] 
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' 
                      : 'border-black/5 bg-[#FDFDFD] text-text/40'}
                  `}
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center border-2 
                    ${meta.specialHandling?.[item.key] ? 'border-indigo-500 bg-indigo-500' : 'border-black/20'}
                  `}>
                    {meta.specialHandling?.[item.key] && <ShieldCheck size={14} className="text-white" />}
                  </div>
                  <span className="font-bold text-sm">{item.label}</span>
                </div>
              ))}
            </div>

            {renderField('Remarks / Instructions', meta.remarks, 'remarks')}
          </div>

        </div>

      </div>
    </div>
  );
}
