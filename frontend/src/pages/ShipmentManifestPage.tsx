import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Edit3, Save, X, Printer, Loader2
} from 'lucide-react';
import { shipmentsAPI } from '@/services/api';

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
      <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center">
        <Loader2 className="animate-spin text-gray-500 w-8 h-8" />
      </div>
    );
  }

  if (isError || !shipment) {
    return (
      <div className="p-8 font-sans">
        <div className="bg-red-50 text-red-600 p-4 border border-red-200">
          Failed to load shipment details. Please try again later.
        </div>
        <button onClick={() => navigate(-1)} className="mt-4 flex items-center gap-2 text-gray-600 hover:text-black">
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

  // Smart Fallbacks
  const dps = Array.isArray(shipment?.delivery_points) ? shipment.delivery_points : (shipment?.delivery_point ? [shipment.delivery_point] : []);
  const dp = dps.length > 0 ? dps[dps.length - 1] : (shipment?.drop_location || {lat: shipment?.dest_lat, lng: shipment?.dest_lng});
  
  const calcDist = () => {
    if (!shipment?.origin_lat || !shipment?.origin_lng) return null;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const R = 6371;
    const getDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    let totalDist = 0;
    let currLat = shipment.origin_lat;
    let currLng = shipment.origin_lng;
    
    let points = [...dps];
    if (points.length === 0) {
      const destLat = shipment?.drop_location?.lat || shipment?.dest_lat;
      const destLng = shipment?.drop_location?.lng || shipment?.dest_lng;
      if (destLat && destLng) {
         points = [{ latitude: destLat, longitude: destLng }];
      }
    }

    if (points.length === 0) return null;

    points.forEach((p: any) => {
      const pLat = p?.latitude || p?.lat;
      const pLng = p?.longitude || p?.lng;
      if (pLat && pLng) {
        totalDist += getDist(currLat, currLng, pLat, pLng);
        currLat = pLat;
        currLng = pLng;
      }
    });

    return totalDist === 0 ? null : totalDist;
  };

  const calculatedDist = calcDist();
  const calculatedEta = calculatedDist ? (() => {
    const hrs = calculatedDist / 40;
    const d = new Date(shipment.created_at || Date.now());
    d.setHours(d.getHours() + hrs);
    return `${d.toISOString().split('T')[0]} (Est.)`;
  })() : null;

  const fallbackData = {
    consigneeName: meta.consigneeName || dp?.name || shipment?.dest_name || shipment?.customer?.name || null,
    consigneeContact: meta.consigneeContact || dp?.phone || dp?.contact_number || shipment?.customer?.phone || null,
    consigneeEmail: meta.consigneeEmail || dp?.email || shipment?.customer?.email || null,
    dispatch_date: meta.dispatch_date || (shipment?.created_at ? shipment.created_at.split('T')[0] : null),
    reporting_date: meta.reporting_date || (shipment?.created_at ? shipment.created_at.split('T')[0] : null),
    eta_text: meta.eta_details?.eta_text || calculatedEta,
    distance_km: meta.eta_details?.distance_km || (calculatedDist ? calculatedDist.toFixed(1) : null),
    productCategory: meta.productCategory || shipment?.parcels?.[0]?.category || 'General Cargo',
    productName: meta.productName || (shipment?.parcels?.[0]?.is_hazardous ? 'Hazardous Materials' : 'Standard Items'),
    brand: meta.brand || 'Generic',
    packagingType: meta.packagingType || 'Standard Box/Pallet',
    noOfPackages: meta.noOfPackages || String(shipment?.total_items || 1),
    grossWeight: meta.grossWeight || (shipment?.total_weight_kg ? `${shipment.total_weight_kg} KG` : 'Unknown'),
    declaredValue: meta.declaredValue || (shipment?.asking_price ? `₹${shipment.asking_price}` : null)
  };

  const handleSave = () => {
    updateMutation.mutate(editData);
  };

  const printDocument = () => {
    window.print();
  };

  const renderField = (label: string, value: any, fieldKey: string, type = 'text') => {
    if (isEditing) {
      if (type === 'checkbox') {
        const isChecked = meta.specialHandling?.[fieldKey] || false;
        return (
          <label className="flex items-center gap-2 text-sm text-black cursor-pointer">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => handleCheckboxChange(fieldKey)}
              className="w-4 h-4 rounded-none border-black focus:ring-black"
            />
            {label}
          </label>
        );
      }

      return (
        <div className="flex flex-col gap-1 w-full">
          <label className="text-xs font-bold text-gray-600 uppercase tracking-tight">{label}</label>
          <input
            type={type}
            value={value || ''}
            onChange={(e) => handleInputChange(fieldKey, e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-none px-2 py-1 text-sm text-black focus:outline-none focus:border-black transition-colors"
          />
        </div>
      );
    }

    if (type === 'checkbox') {
      const isChecked = meta.specialHandling?.[fieldKey] || false;
      return (
        <div className="flex items-center gap-2 text-sm text-black">
          <div className="w-3 h-3 border border-black flex items-center justify-center">
            {isChecked && <div className="w-1.5 h-1.5 bg-black" />}
          </div>
          {label}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1 w-full">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>
        <div className="text-sm font-semibold text-black uppercase">
          {value || <span className="text-gray-400 italic normal-case font-normal">N/A</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8 font-sans print:bg-white print:p-0">

      {/* Action Bar (Hidden in Print) */}
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-black transition-colors font-medium text-sm"
        >
          <ArrowLeft size={16} /> Back to Shipments
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={printDocument}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-sm text-black font-semibold shadow-sm transition-colors"
          >
            <Printer size={16} /> Print Document
          </button>

          {isEditing ? (
            <>
              <button
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-sm text-black font-semibold shadow-sm transition-colors"
                disabled={updateMutation.isPending}
              >
                <X size={16} /> Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 border border-black bg-black hover:bg-gray-800 text-sm text-white font-semibold shadow-sm transition-colors"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <Save size={16} />}
                Save Changes
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-4 py-2 border border-black bg-black hover:bg-gray-800 text-sm text-white font-semibold shadow-sm transition-colors"
            >
              <Edit3 size={16} /> Edit Manifest
            </button>
          )}
        </div>
      </div>

      {/* Formal Document Container */}
      <div className="max-w-4xl mx-auto bg-white border border-gray-300 shadow-sm p-8 print:border-none print:shadow-none print:max-w-full">

        {/* Document Header */}
        <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-widest text-black uppercase">Cargo Manifest / Waybill</h1>
            <p className="text-xs font-semibold text-gray-600 tracking-wider mt-1">GOVERNMENT PORTAL FORMAT COMPLIANT</p>
          </div>
          <div className="text-right flex flex-col items-end">
            <div className="border-2 border-black p-2 bg-gray-50 mb-2">
              <p className="font-mono font-bold text-lg tracking-[0.2em]">{shipment.tracking_id}</p>
            </div>
            <div className="text-[10px] uppercase font-bold text-gray-500">
              System ID: <span className="text-black font-mono">{shipment.id.substring(0, 18)}...</span>
            </div>
          </div>
        </div>

        {/* Section 1: Addresses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-l border-black mb-6">
          <div className="border-b border-r border-black p-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-2 bg-gray-100 p-1 border border-gray-300 inline-block">1. Consignor (Origin)</div>
            <p className="text-sm font-semibold text-black uppercase mt-2">{shipment.pickup_location?.address || shipment.origin_address || 'N/A'}</p>
            {isEditing && (
              <p className="text-[10px] text-gray-400 mt-2 italic">* Origin address is system-generated from route details.</p>
            )}
          </div>
          <div className="border-b border-r border-black p-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-2 bg-gray-100 p-1 border border-gray-300 inline-block">2. Consignee (Destination)</div>
            <div className="space-y-3 mt-3">
              {renderField('Full Name', fallbackData.consigneeName, 'consigneeName')}
              {renderField('Contact Number', fallbackData.consigneeContact, 'consigneeContact')}
              {renderField('Email Address', fallbackData.consigneeEmail, 'consigneeEmail')}
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Destination Address</label>
                <p className="text-sm font-semibold text-black uppercase">{dp?.address || shipment.drop_location?.address || shipment.dest_address || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Logistics Details */}
        <div className="mb-6">
          <div className="bg-black text-white text-xs font-bold uppercase tracking-wider p-1.5 pl-3 border border-black">3. Logistics Parameters</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-l border-b border-black">
            <div className="border-r border-black p-3">
              {renderField('Dispatch Date', fallbackData.dispatch_date, 'dispatch_date', 'date')}
            </div>
            <div className="border-r border-black p-3">
              {renderField('Reporting Date', fallbackData.reporting_date, 'reporting_date', 'date')}
            </div>
            <div className="border-r border-black p-3">
              {renderField('Estimated ETA', fallbackData.eta_text, 'eta_details.eta_text')}
            </div>
            <div className="border-r border-black p-3">
              {renderField('Distance (KM)', fallbackData.distance_km, 'eta_details.distance_km')}
            </div>
          </div>
        </div>

        {/* Section 3: Cargo Particulars */}
        <div className="mb-6">
          <div className="bg-black text-white text-xs font-bold uppercase tracking-wider p-1.5 pl-3 border border-black">4. Cargo Particulars</div>
          <div className="border-l border-black">
            <div className="grid grid-cols-1 md:grid-cols-3 border-b border-black">
              <div className="border-r border-black p-3">
                {renderField('Product Category', fallbackData.productCategory, 'productCategory')}
              </div>
              <div className="border-r border-black p-3">
                {renderField('Product Name', fallbackData.productName, 'productName')}
              </div>
              <div className="border-r border-black p-3">
                {renderField('Brand / Make', fallbackData.brand, 'brand')}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 border-b border-black">
              <div className="border-r border-black p-3">
                {renderField('Packaging Type', fallbackData.packagingType, 'packagingType')}
              </div>
              <div className="border-r border-black p-3">
                {renderField('No. of Packages', fallbackData.noOfPackages, 'noOfPackages', 'number')}
              </div>
              <div className="border-r border-black p-3 bg-gray-50">
                {renderField('Gross Weight', fallbackData.grossWeight, 'grossWeight')}
              </div>
              <div className="border-r border-black p-3 bg-gray-50">
                {renderField('Declared Value', fallbackData.declaredValue, 'declaredValue')}
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Special Handling & Remarks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-l border-black mb-12">
          <div className="border-b border-r border-black p-4 bg-gray-50">
            <div className="text-xs font-bold uppercase tracking-wider mb-4 border-b border-gray-300 pb-1">5. Special Handling Flags</div>
            <div className="grid grid-cols-2 gap-4">
              {renderField('Fragile Cargo', null, 'fragile', 'checkbox')}
              {renderField('Hazardous (Hazmat)', null, 'hazardous', 'checkbox')}
              {renderField('Cold Chain / Temp Controlled', null, 'coldChain', 'checkbox')}
              {renderField('Stackable', null, 'stackable', 'checkbox')}
              {renderField('High Value', null, 'highValue', 'checkbox')}
              {renderField('Long Haul', null, 'longHaul', 'checkbox')}
            </div>
          </div>
          <div className="border-b border-r border-black p-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-3 border-b border-gray-300 pb-1">6. Remarks & Instructions</div>
            {isEditing ? (
              <textarea
                value={meta.remarks || ''}
                onChange={(e) => handleInputChange('remarks', e.target.value)}
                className="w-full bg-white border border-gray-300 p-2 text-sm text-black focus:outline-none focus:border-black min-h-[100px]"
                placeholder="Enter remarks or special instructions..."
              />
            ) : (
              <div className="text-sm font-semibold text-black uppercase min-h-[100px]">
                {meta.remarks || <span className="text-gray-400 italic normal-case font-normal">No additional remarks</span>}
              </div>
            )}
          </div>
        </div>

        {/* Footer Signatures */}
        <div className="grid grid-cols-3 gap-8 mt-12 pt-8 border-t border-dashed border-gray-400">
          <div className="text-center">
            <div className="border-b border-black h-12 mb-2"></div>
            <p className="text-xs font-bold uppercase text-black">Consignor Signature</p>
          </div>
          <div className="text-center">
            <div className="border-b border-black h-12 mb-2 flex items-end justify-center pb-1 overflow-hidden">
              {meta.transporter_signature && (
                <span className="font-serif italic font-bold text-lg text-blue-800 transform -rotate-2">{meta.transporter_signature}</span>
              )}
            </div>
            <p className="text-xs font-bold uppercase text-black">Transporter Signature</p>
          </div>
          <div className="text-center">
            <div className="border-b border-black h-12 mb-2"></div>
            <p className="text-xs font-bold uppercase text-black">Consignee Signature</p>
            <p className="text-[9px] text-gray-500 mt-1">(Sign upon delivery)</p>
          </div>
        </div>

        <div className="mt-8 text-center text-[9px] text-gray-400 uppercase tracking-widest border-t border-black pt-2">
          System Generated Document • margixindia Logistics Platform • {new Date().toISOString().split('T')[0]}
        </div>

      </div>
    </div>
  );
}
