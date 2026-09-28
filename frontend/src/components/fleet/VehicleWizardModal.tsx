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
        const draft = localStorage.getItem('vehicle_form_draft');
        if (draft) {
          try {
            const parsed = JSON.parse(draft);
            setFormData({ ...DEFAULT_FORM_DATA, ...parsed.data });
            setStep(parsed.step || 1);
          } catch (e) {}
        } else {
          setFormData(DEFAULT_FORM_DATA);
          setStep(1);
        }
      }
    }
  }, [isOpen, initialData]);

  const saveDraft = () => {
    if (!isEditing) {
      localStorage.setItem('vehicle_form_draft', JSON.stringify({ data: formData, step }));
      toast.success('Draft archived successfully');
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
    mutationFn: (data: typeof formData) => isEditing ? vehiclesAPI.update(initialData.id, data) : vehiclesAPI.create({ ...data, status: 'available' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      toast.success(isEditing ? 'Vehicle updated successfully' : 'Vehicle added successfully');
      if (!isEditing) localStorage.removeItem('vehicle_form_draft');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Failed to save vehicle')
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface2/80 backdrop-blur-sm" onClick={saveDraft} />
      <Card className="w-full max-w-2xl animate-fade-up relative z-10 glass shadow-xl overflow-hidden border-slate-200 bg-white flex flex-col max-h-[90vh]" glass={false}>
        <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-yellow-400/20 rounded-lg flex items-center justify-center border border-yellow-400/30">
              <Truck size={16} className="text-yellow-400" />
            </div>
            <h2 className="font-heading font-bold text-lg text-slate-900">{isEditing ? 'Update Vehicle Info' : 'Add Fleet Asset'}</h2>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <button onClick={saveDraft} className="text-muted hover:text-slate-900 transition-colors p-2 rounded-lg hover:bg-slate-200" title="Archive / Minimize">
                <Minus size={20} />
              </button>
            )}
            <button onClick={onClose} className="text-muted hover:text-slate-900 transition-colors p-2 rounded-lg hover:bg-slate-200">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-between px-8 py-4 bg-slate-50 border-b border-slate-200 flex-shrink-0">
          {[
            { num: 1, label: 'Vehicle Details', icon: Truck },
            { num: 2, label: 'Driver & GPS', icon: User },
            { num: 3, label: 'Documents', icon: FileText }
          ].map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${step >= s.num ? 'bg-primary text-primary-foreground' : 'bg-slate-200 text-slate-500'}`}>
                {s.num}
              </div>
              <span className={`text-sm font-bold hidden sm:block ${step >= s.num ? 'text-slate-900' : 'text-slate-500'}`}>{s.label}</span>
              {i < 2 && <div className={`w-8 sm:w-16 h-1 mx-2 rounded-full ${step > s.num ? 'bg-primary' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Plate Number</label>
                <input required className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 mono" placeholder="e.g. MH-01-AB-1234" value={formData.plate_number} onChange={e => setFormData({ ...formData, plate_number: e.target.value.toUpperCase() })} />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Truck Model (Presets)</label>
                <select className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none" value={formData.vehicle_model} onChange={e => {
                  const m = e.target.value;
                  const preset = INDIAN_TRUCK_PRESETS[m];
                  if (preset && m !== 'Custom') {
                    setFormData(prev => ({ ...prev, vehicle_model: m, capacity_kg: preset.capacity_kg, container_length_ft: preset.container_length_ft, container_width_ft: preset.container_width_ft, container_height_ft: preset.container_height_ft, fuel_type: preset.fuel_type, fuel_capacity_liters: preset.fuel_capacity_liters, fuel_efficiency_kmpl: preset.fuel_efficiency_kmpl }));
                  } else {
                    setFormData(prev => ({ ...prev, vehicle_model: m }));
                  }
                }}>
                  <option value="">— Custom —</option>
                  {Object.keys(INDIAN_TRUCK_PRESETS).map(m => <option key={m} value={m}>{m} — {INDIAN_TRUCK_PRESETS[m].capacity_kg} kg</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Vehicle Type</label>
                  <select className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none" value={formData.vehicle_type} onChange={e => handleTypeChange(e.target.value)}>
                    {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Capacity (kg)</label>
                  <input type="number" required className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none mono" value={formData.capacity_kg} onChange={e => handleCapacityChange(Number(e.target.value))} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Container Size (L × W × H ft)</label>
                <div className="grid grid-cols-3 gap-3">
                  <input type="number" step="0.5" placeholder="L" className="w-full bg-surface2 border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none mono" value={formData.container_length_ft || ''} onChange={e => setFormData({ ...formData, container_length_ft: Number(e.target.value) })} />
                  <input type="number" step="0.5" placeholder="W" className="w-full bg-surface2 border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none mono" value={formData.container_width_ft || ''} onChange={e => setFormData({ ...formData, container_width_ft: Number(e.target.value) })} />
                  <input type="number" step="0.5" placeholder="H" className="w-full bg-surface2 border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none mono" value={formData.container_height_ft || ''} onChange={e => setFormData({ ...formData, container_height_ft: Number(e.target.value) })} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Spark GPS ID (Optional)</label>
                <input className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none mono" placeholder="Hardware ID" value={formData.spark_id} onChange={e => setFormData({ ...formData, spark_id: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Driver Name</label>
                  <input className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none" placeholder="Name" value={formData.driver_name} onChange={e => setFormData({ ...formData, driver_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Driver Phone (+91)</label>
                  <input className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none mono" placeholder="9876543210" value={formData.driver_phone} onChange={e => setFormData({ ...formData, driver_phone: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-fade-in">
              {['rc', 'insurance', 'fitness', 'permit', 'puc'].map(doc => (
                <div key={doc} className="grid grid-cols-[2fr_1fr] gap-3 items-end p-3 rounded-xl border border-slate-100 bg-slate-50">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">{doc.toUpperCase()} Number</label>
                    <input className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none mono" 
                           placeholder={`Enter ${doc.toUpperCase()} no.`}
                           value={(formData as any)[`${doc}_number`] || ''}
                           onChange={e => setFormData({ ...formData, [`${doc}_number`]: e.target.value.toUpperCase() })} 
                           pattern={doc === 'rc' ? "^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$" : undefined}
                           title={doc === 'rc' ? "Valid Indian RC format (e.g. MH01AB1234)" : undefined} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Expiry Date</label>
                    <input type="date" className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none mono" 
                           value={(formData as any)[`${doc}_expiry`] || ''}
                           onChange={e => setFormData({ ...formData, [`${doc}_expiry`]: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center flex-shrink-0">
          <button type="button" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1} className="px-5 py-2.5 rounded-xl font-bold text-sm bg-slate-200 text-slate-600 disabled:opacity-50 flex items-center gap-2 hover:bg-slate-300 transition-colors">
            <ArrowLeft size={16} /> Back
          </button>
          
          {step < 3 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="px-5 py-2.5 rounded-xl font-bold text-sm bg-primary text-primary-foreground flex items-center gap-2 hover:bg-primary/90 transition-colors">
              Next Step <ArrowRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={() => mutation.mutate(formData)} disabled={mutation.isPending} className="px-6 py-2.5 rounded-xl font-bold text-sm bg-green-500 text-white flex items-center gap-2 hover:bg-green-600 transition-colors">
              <Save size={16} /> {mutation.isPending ? 'Saving...' : (isEditing ? 'Update Vehicle' : 'Finish & Add Vehicle')}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
