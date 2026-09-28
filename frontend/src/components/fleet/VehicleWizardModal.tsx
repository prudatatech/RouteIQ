import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vehiclesAPI } from '@/services/api';
import toast from 'react-hot-toast';
import { X, Truck, User, FileText, ArrowRight, ArrowLeft, Save, Minus } from 'lucide-react';
import { Card } from '@/components/ui';

const VEHICLE_TYPES = ['truck', 'van', 'bike', 'car'];
const FUEL_TYPES = ['diesel', 'petrol', 'electric', 'cng'];

export const INDIAN_TRUCK_PRESETS: Record<string, { capacity_kg: number; container_length_ft: number; container_width_ft: number; container_height_ft: number; fuel_type: string; fuel_capacity_liters: number; fuel_efficiency_kmpl: number }> = {
  'Tata Ace (Chota Hathi)': { capacity_kg: 750, container_length_ft: 7, container_width_ft: 4.5, container_height_ft: 4.5, fuel_type: 'diesel', fuel_capacity_liters: 30, fuel_efficiency_kmpl: 18 },
  'Mahindra Bolero Pickup': { capacity_kg: 1200, container_length_ft: 8, container_width_ft: 5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 50, fuel_efficiency_kmpl: 14 },
  'Ashok Leyland Dost': { capacity_kg: 1500, container_length_ft: 9, container_width_ft: 5.5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 40, fuel_efficiency_kmpl: 16 },
  'Ashok Leyland Bada Dost': { capacity_kg: 2000, container_length_ft: 10, container_width_ft: 5.5, container_height_ft: 5.5, fuel_type: 'diesel', fuel_capacity_liters: 45, fuel_efficiency_kmpl: 15 },
  'Maruti Super Carry': { capacity_kg: 740, container_length_ft: 7, container_width_ft: 4.5, container_height_ft: 4, fuel_type: 'cng', fuel_capacity_liters: 30, fuel_efficiency_kmpl: 22 },
  'Tata Intra': { capacity_kg: 1500, container_length_ft: 9, container_width_ft: 5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 40, fuel_efficiency_kmpl: 16 },
  'Tata Yodha': { capacity_kg: 2500, container_length_ft: 10, container_width_ft: 6, container_height_ft: 6, fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 14 },
  'Piaggio Ape Cargo': { capacity_kg: 500, container_length_ft: 5, container_width_ft: 4, container_height_ft: 4, fuel_type: 'cng', fuel_capacity_liters: 15, fuel_efficiency_kmpl: 25 },
  'Tata 407': { capacity_kg: 3500, container_length_ft: 14, container_width_ft: 6, container_height_ft: 6, fuel_type: 'diesel', fuel_capacity_liters: 80, fuel_efficiency_kmpl: 10 },
  'Eicher Pro 1049': { capacity_kg: 5000, container_length_ft: 17, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 120, fuel_efficiency_kmpl: 8 },
  'Tata 709 / 1109': { capacity_kg: 9000, container_length_ft: 19, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 150, fuel_efficiency_kmpl: 6 },
  'Eicher Pro 2049': { capacity_kg: 9000, container_length_ft: 20, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 150, fuel_efficiency_kmpl: 6 },
  'BharatBenz 1015R': { capacity_kg: 10000, container_length_ft: 20, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 160, fuel_efficiency_kmpl: 5.5 },
  'Tata Signa (Multi-axle)': { capacity_kg: 25000, container_length_ft: 32, container_width_ft: 8, container_height_ft: 8, fuel_type: 'diesel', fuel_capacity_liters: 300, fuel_efficiency_kmpl: 4 },
  'Ashok Leyland U-Truck': { capacity_kg: 25000, container_length_ft: 32, container_width_ft: 8, container_height_ft: 8, fuel_type: 'diesel', fuel_capacity_liters: 300, fuel_efficiency_kmpl: 4 },
  'Volvo FM / FMX': { capacity_kg: 40000, container_length_ft: 40, container_width_ft: 8, container_height_ft: 9, fuel_type: 'diesel', fuel_capacity_liters: 400, fuel_efficiency_kmpl: 3.5 },
  'Custom': { capacity_kg: 1000, container_length_ft: 0, container_width_ft: 0, container_height_ft: 0, fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 12 },
};

const DEFAULT_FORM_DATA = {
  plate_number: '', vehicle_type: 'truck', vehicle_model: '', capacity_kg: 1000,
  fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 12,
  spark_id: '', driver_name: '', driver_phone: '',
  container_length_ft: 0, container_width_ft: 0, container_height_ft: 0,
  rc_number: '', rc_expiry: '', rc_document_url: '',
  insurance_number: '', insurance_expiry: '', insurance_document_url: '',
  fitness_certificate_number: '', fitness_expiry: '', fitness_document_url: '',
  permit_number: '', permit_expiry: '', permit_document_url: '',
  puc_number: '', puc_expiry: '', puc_document_url: '',
  status: 'available',
};

export default function VehicleWizardModal({ isOpen, onClose, initialData = null }: { isOpen: boolean; onClose: () => void; initialData?: any }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState(DEFAULT_FORM_DATA);
  const isEditing = !!initialData;

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({ ...DEFAULT_FORM_DATA, ...initialData });
        setStep(1);
      } else {
        setFormData(DEFAULT_FORM_DATA);
        setStep(1);
      }
    }
  }, [isOpen, initialData]);

  const saveDraft = async () => {
    try {
      const dataToSave: any = { ...formData, status: 'archived' };
      if (!dataToSave.plate_number) {
        dataToSave.plate_number = `DRFT-${Math.floor(Math.random() * 100000)}`;
      }
      
      if (isEditing) {
        await vehiclesAPI.update(initialData.id, dataToSave);
      } else {
        await vehiclesAPI.create(dataToSave);
      }
      
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      toast.success('Draft archived successfully');
    } catch (e: any) {
      toast.error('Failed to archive draft to server');
    }
    onClose();
  };

  const handleTypeChange = (type: string) => {
    let updates: any = { vehicle_type: type };
    if (!formData.vehicle_model || formData.vehicle_model === 'Custom') {
      if (type === 'van') { updates.capacity_kg = 1500; updates.container_length_ft = 10; updates.container_width_ft = 5; updates.container_height_ft = 5.5; }
      else if (type === 'bike') { updates.capacity_kg = 50; updates.container_length_ft = 2; updates.container_width_ft = 1.5; updates.container_height_ft = 1.5; }
      else if (type === 'car') { updates.capacity_kg = 300; updates.container_length_ft = 4; updates.container_width_ft = 3; updates.container_height_ft = 2.5; }
      else if (type === 'truck') { updates.capacity_kg = 9000; updates.container_length_ft = 19; updates.container_width_ft = 7; updates.container_height_ft = 7; }
    }
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const handleCapacityChange = (cap: number) => {
    let updates: any = { capacity_kg: cap };
    if (!formData.vehicle_model || formData.vehicle_model === 'Custom') {
      if (formData.vehicle_type === 'truck') {
        let closest = INDIAN_TRUCK_PRESETS['Tata Ace (Chota Hathi)'];
        let minDiff = Infinity;
        for (const [name, preset] of Object.entries(INDIAN_TRUCK_PRESETS)) {
          if (name === 'Custom') continue;
          const diff = Math.abs(preset.capacity_kg - cap);
          if (diff < minDiff) { minDiff = diff; closest = preset; }
        }
        if (closest) {
          updates.container_length_ft = closest.container_length_ft;
          updates.container_width_ft = closest.container_width_ft;
          updates.container_height_ft = closest.container_height_ft;
        }
      }
    }
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const mutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const payload = { ...data, status: data.status === 'archived' ? 'available' : (data.status || 'available') };
      return isEditing ? vehiclesAPI.update(initialData.id, payload) : vehiclesAPI.create(payload);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      toast.success(isEditing && formData.status === 'archived' ? 'Vehicle finalized' : (isEditing ? 'Vehicle updated successfully' : 'Vehicle added successfully'));
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Failed to save vehicle')
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={saveDraft} />
      <Card className="w-full max-w-5xl animate-fade-up relative z-10 glass shadow-2xl overflow-hidden border-slate-200 bg-white flex h-[85vh] max-h-[800px] p-0" glass={false}>
        
        {/* Left Sidebar Stepper */}
        <div className="w-72 bg-slate-50 border-r border-slate-200 flex flex-col hidden md:flex">
          <div className="p-6 border-b border-slate-200 flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-400/20 rounded-xl flex items-center justify-center border border-yellow-400/30">
              <Truck size={20} className="text-yellow-600" />
            </div>
            <h2 className="font-heading font-bold text-lg text-slate-900 leading-tight">
              {isEditing ? 'Update Asset' : 'Add Fleet Asset'}
            </h2>
          </div>
          
          <div className="p-8 flex-1">
            <div className="space-y-8 relative">
              {/* Vertical line connecting steps */}
              <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-slate-200 z-0" />

              {[
                { num: 1, label: 'Vehicle Details', icon: Truck, desc: 'Model & capacity' },
                { num: 2, label: 'Driver & GPS', icon: User, desc: 'Tracking setup' },
                { num: 3, label: 'Documents', icon: FileText, desc: 'RC, Insurance, etc.' }
              ].map((s, i) => (
                <div key={s.num} className={`relative z-10 flex items-start gap-4 transition-all duration-300 ${step === s.num ? 'opacity-100 translate-x-1' : 'opacity-60 hover:opacity-80'}`}>
                  <div className={`w-10 h-10 rounded-full flex flex-shrink-0 items-center justify-center font-bold text-sm transition-colors ${step >= s.num ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-white border-2 border-slate-200 text-slate-400'}`}>
                    <s.icon size={18} />
                  </div>
                  <div className="pt-1">
                    <p className={`text-sm font-bold ${step >= s.num ? 'text-slate-900' : 'text-slate-500'}`}>{s.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
          <div className="p-6 px-8 border-b border-slate-100 flex justify-between items-center bg-white flex-shrink-0 relative z-20">
            <h3 className="font-heading font-bold text-xl text-slate-900 md:hidden">
              {isEditing ? 'Update Vehicle' : 'Add Vehicle'} - Step {step}
            </h3>
            <h3 className="font-heading font-bold text-xl text-slate-900 hidden md:block">
              {step === 1 ? 'Vehicle Details' : step === 2 ? 'Driver & GPS' : 'Documents & Permits'}
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={saveDraft} className="text-muted hover:text-slate-900 transition-colors px-3 py-2 rounded-lg hover:bg-slate-100 flex items-center gap-2 text-sm font-bold border border-transparent hover:border-slate-200" title="Archive / Minimize">
                <Minus size={16} /> <span className="hidden sm:inline">Save Draft</span>
              </button>
              <div className="w-px h-6 bg-slate-200 mx-1 hidden sm:block" />
              <button onClick={onClose} className="text-muted hover:bg-red-50 hover:text-red-600 transition-colors p-2 rounded-lg">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="p-8 overflow-y-auto flex-1 bg-slate-50/30">
            <div className="max-w-2xl mx-auto">
              {step === 1 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Plate Number</label>
                    <input required className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all font-mono shadow-sm" placeholder="e.g. MH-01-AB-1234" value={formData.plate_number} onChange={e => setFormData({ ...formData, plate_number: e.target.value.toUpperCase() })} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Truck Model (Presets)</label>
                    <select className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all shadow-sm" value={formData.vehicle_model} onChange={e => {
                      const m = e.target.value;
                      const preset = INDIAN_TRUCK_PRESETS[m];
                      if (preset && m !== 'Custom') {
                        setFormData(prev => ({ ...prev, vehicle_model: m, capacity_kg: preset.capacity_kg, container_length_ft: preset.container_length_ft, container_width_ft: preset.container_width_ft, container_height_ft: preset.container_height_ft, fuel_type: preset.fuel_type, fuel_capacity_liters: preset.fuel_capacity_liters, fuel_efficiency_kmpl: preset.fuel_efficiency_kmpl }));
                      } else {
                        setFormData(prev => ({ ...prev, vehicle_model: m }));
                      }
                    }}>
                      <option value="">— Custom Build —</option>
                      {Object.keys(INDIAN_TRUCK_PRESETS).map(m => <option key={m} value={m}>{m} — {INDIAN_TRUCK_PRESETS[m].capacity_kg} kg</option>)}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Vehicle Type</label>
                      <select className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all shadow-sm" value={formData.vehicle_type} onChange={e => handleTypeChange(e.target.value)}>
                        {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Capacity (kg)</label>
                      <input type="number" required className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all font-mono shadow-sm" value={formData.capacity_kg} onChange={e => handleCapacityChange(Number(e.target.value))} />
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Container Dimensions (L × W × H in feet)</label>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="relative">
                        <input type="number" step="0.5" className="w-full bg-white border border-slate-200 rounded-xl pl-4 pr-8 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all font-mono shadow-sm" value={formData.container_length_ft || ''} onChange={e => setFormData({ ...formData, container_length_ft: Number(e.target.value) })} />
                        <span className="absolute right-3 top-3.5 text-slate-400 text-sm font-bold">L</span>
                      </div>
                      <div className="relative">
                        <input type="number" step="0.5" className="w-full bg-white border border-slate-200 rounded-xl pl-4 pr-8 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all font-mono shadow-sm" value={formData.container_width_ft || ''} onChange={e => setFormData({ ...formData, container_width_ft: Number(e.target.value) })} />
                        <span className="absolute right-3 top-3.5 text-slate-400 text-sm font-bold">W</span>
                      </div>
                      <div className="relative">
                        <input type="number" step="0.5" className="w-full bg-white border border-slate-200 rounded-xl pl-4 pr-8 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all font-mono shadow-sm" value={formData.container_height_ft || ''} onChange={e => setFormData({ ...formData, container_height_ft: Number(e.target.value) })} />
                        <span className="absolute right-3 top-3.5 text-slate-400 text-sm font-bold">H</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6 animate-fade-in">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Spark GPS ID (Optional)</label>
                    <input className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all font-mono shadow-sm" placeholder="Hardware Device ID" value={formData.spark_id} onChange={e => setFormData({ ...formData, spark_id: e.target.value })} />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-5 pt-2">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Driver Name</label>
                      <input className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all shadow-sm" placeholder="Full Name" value={formData.driver_name} onChange={e => setFormData({ ...formData, driver_name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1">Driver Phone</label>
                      <input className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/10 transition-all font-mono shadow-sm" placeholder="+91 98765 43210" value={formData.driver_phone} onChange={e => setFormData({ ...formData, driver_phone: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4 animate-fade-in">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3 mb-6">
                    <FileText className="text-blue-500 flex-shrink-0" size={20} />
                    <p className="text-sm text-blue-800">
                      Upload your vehicle documents to ensure compliance. If you don't have them all right now, you can <b>Save Draft</b> and return later.
                    </p>
                  </div>

                  {['rc', 'insurance', 'fitness', 'permit', 'puc'].map(doc => (
                    <div key={doc} className="grid grid-cols-[2fr_1fr] gap-4 items-end p-4 rounded-xl border border-slate-200 bg-white shadow-sm hover:border-yellow-300 transition-colors group">
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1 group-hover:text-slate-700 transition-colors">{doc.toUpperCase()} Number</label>
                        <input className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-yellow-400 focus:bg-white transition-all font-mono" 
                               placeholder={`Enter ${doc.toUpperCase()} no.`}
                               value={(formData as any)[`${doc}_number`] || ''}
                               onChange={e => setFormData({ ...formData, [`${doc}_number`]: e.target.value.toUpperCase() })} 
                               pattern={doc === 'rc' ? "^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$" : undefined}
                               title={doc === 'rc' ? "Valid Indian RC format (e.g. MH01AB1234)" : undefined} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-widest font-bold text-slate-500 ml-1 group-hover:text-slate-700 transition-colors">Expiry Date</label>
                        <input type="date" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-yellow-400 focus:bg-white transition-all font-mono" 
                               value={(formData as any)[`${doc}_expiry`] || ''}
                               onChange={e => setFormData({ ...formData, [`${doc}_expiry`]: e.target.value })} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer Navigation */}
          <div className="p-6 px-8 bg-white border-t border-slate-100 flex justify-between items-center flex-shrink-0 z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
            <button type="button" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1} className="px-6 py-3 rounded-xl font-bold text-sm bg-slate-100 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 hover:bg-slate-200 transition-colors">
              <ArrowLeft size={16} /> Back
            </button>
            
            {step < 3 ? (
              <button type="button" onClick={() => setStep(step + 1)} className="px-8 py-3 rounded-xl font-bold text-sm bg-slate-900 text-white flex items-center gap-2 hover:bg-slate-800 hover:shadow-lg hover:shadow-slate-900/20 transition-all hover:scale-[1.02]">
                Next Step <ArrowRight size={16} />
              </button>
            ) : (
              <button type="button" onClick={() => mutation.mutate(formData)} disabled={mutation.isPending} className="px-8 py-3 rounded-xl font-bold text-sm bg-primary text-primary-foreground flex items-center gap-2 hover:bg-yellow-300 hover:shadow-lg hover:shadow-primary/30 transition-all hover:scale-[1.02] border border-yellow-500">
                <Save size={18} /> {mutation.isPending ? 'Saving...' : (isEditing ? 'Update Vehicle' : 'Finish & Add Vehicle')}
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
