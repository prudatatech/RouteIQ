import { useRef } from 'react'
import { X } from 'lucide-react'
import { Alert, Card, Checkbox, IconButton, Input, Select } from '@/components/ui'
import type { ProductRow } from '@/types/load'
import type { ProductNote } from './helpers'
import HsnSearch from './HsnSearch'
import type { StepErrors } from './validate'

const num = (v: string) => v.replace(/[^\d.]/g, '')

const HANDLING_OPTIONS = [
  { id: 'fragile', label: 'Fragile' },
  { id: 'do_not_stack', label: 'Do Not Stack' },
  { id: 'this_side_up', label: 'This Side Up' },
  { id: 'stackable', label: 'Stackable' },
  { id: 'hazmat', label: 'Hazardous / Hazmat' },
  { id: 'odc', label: 'ODC' },
  { id: 'temperature_controlled', label: 'Reefer / Temperature Controlled' },
  { id: 'liquid', label: 'Liquid' },
  { id: 'perishable', label: 'Perishable' },
  { id: 'high_value', label: 'High Value' },
]

export default function PtlProductCard({ row, index, onChange, onRemove, onActivate, errors, notes = [] }: {
  row: ProductRow
  index: number
  onChange: (patch: Partial<ProductRow>) => void
  onRemove?: () => void
  onActivate?: () => void
  errors: StepErrors
  notes?: ProductNote[]
}) {
  const i = index
  const qty = useRef<HTMLInputElement>(null)

  return (
    <Card padded className="scroll-mt-24 space-y-6 !p-6" role="group" aria-label={`Product ${i + 1}`} onFocus={onActivate}>
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-lg font-bold text-text w-full">Product {i + 1}</h3>
        {onRemove && <div className="-mt-1 -mr-2"><IconButton label={`Remove product ${i + 1}`} icon={<X size={16} />} onClick={onRemove} /></div>}
      </div>

      <HsnSearch
        row={row} index={i} onPicked={() => qty.current?.focus()} label="Describe your goods *" onChange={onChange}
        errors={{ name: errors[`product_name_${i}`], hsn: errors[`hsn_code_${i}`], rate: errors[`gst_rate_${i}`] }}
      />
      
      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map(n => <Alert key={n.key} tone={n.severity === 'warn' ? 'warning' : 'info'}>{n.message}</Alert>)}
        </div>
      )}

      {/* Commercial Shipment */}
      <fieldset>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`commercial_${i}`} checked={row.commercial_shipment === 'personal'} onChange={() => onChange({ commercial_shipment: 'personal' })} />
            <span className="text-sm font-medium">Personal / C2C</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`commercial_${i}`} checked={row.commercial_shipment === 'business'} onChange={() => onChange({ commercial_shipment: 'business' })} />
            <span className="text-sm font-medium">Business / Commercial</span>
          </label>
        </div>
      </fieldset>

      <div className="border-t border-border pt-4">
        <h4 className="font-semibold mb-3">Quantity</h4>
        <div className="grid grid-cols-2 gap-4">
          <Input ref={qty} label="Quantity *" required inputMode="decimal" value={row.quantity} onChange={e => onChange({ quantity: num(e.target.value) })} />
          <Select label="Unit *" value={row.unit} onChange={e => onChange({ unit: e.target.value })} options={[
            { value: 'Pieces', label: 'Pieces' }, { value: 'Boxes', label: 'Boxes' }, { value: 'Pallets', label: 'Pallets' }
          ]} />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="font-semibold mb-3">Packaging</h4>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Packaging Type *" value={row.packaging_type || ''} onChange={e => onChange({ packaging_type: e.target.value })} options={[
            { value: '', label: 'Select packaging...' }, { value: 'Bag / Sack', label: 'Bag / Sack' }, { value: 'Box / Carton', label: 'Box / Carton' }, { value: 'Loose', label: 'Loose' }
          ]} />
          <Input label="Number of Packages *" required inputMode="decimal" value={row.num_packages || ''} onChange={e => onChange({ num_packages: num(e.target.value) })} />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="font-semibold mb-3">Weight</h4>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Total Weight (kg) *" required inputMode="decimal" value={row.weight_kg} onChange={e => onChange({ weight_kg: num(e.target.value) })} />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="font-semibold mb-3">Package Dimensions</h4>
        <div className="grid grid-cols-3 gap-4 mb-2">
          <Input label="Length (cm)" inputMode="decimal" value={row.length_cm || ''} onChange={e => onChange({ length_cm: num(e.target.value) })} />
          <Input label="Width (cm)" inputMode="decimal" value={row.width_cm || ''} onChange={e => onChange({ width_cm: num(e.target.value) })} />
          <Input label="Height (cm)" inputMode="decimal" value={row.height_cm || ''} onChange={e => onChange({ height_cm: num(e.target.value) })} />
        </div>
        <p className="text-xs text-muted border-l-2 pl-2 border-brand-fill">Used to calculate volumetric/chargeable weight.</p>
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="font-semibold mb-3">Declared Value</h4>
        <div className="grid grid-cols-2 gap-4 mb-2">
          <Input label="Declared Value (₹)" inputMode="decimal" value={row.declared_value} onChange={e => onChange({ declared_value: num(e.target.value) })} />
        </div>
        <p className="text-xs text-muted">Optional for personal shipments; required/used for commercial documentation and quotation where applicable.</p>
      </div>

      {row.commercial_shipment === 'business' && (
        <div className="border-t border-border pt-4 space-y-4">
          <h4 className="font-semibold">GST & Commercial Details</h4>
          
          <fieldset>
            <legend className="mb-2 text-sm font-medium">GST Applicable?</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={row.gst_applicable === true} onChange={() => onChange({ gst_applicable: true })} /><span className="text-sm">Yes</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={row.gst_applicable === false} onChange={() => onChange({ gst_applicable: false })} /><span className="text-sm">No</span></label>
            </div>
          </fieldset>

          {row.gst_applicable && (
            <div className="w-1/2">
              <Select label="GST Rate" value={row.gst_rate?.toString() || ''} onChange={e => onChange({ gst_rate: Number(e.target.value) })} options={[
                { value: '', label: 'Select rate ▼' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' }
              ]} />
            </div>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Invoice Available?</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={row.invoice_available === true} onChange={() => onChange({ invoice_available: true })} /><span className="text-sm">Yes</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={row.invoice_available === false} onChange={() => onChange({ invoice_available: false })} /><span className="text-sm">No</span></label>
            </div>
          </fieldset>

          {row.invoice_available && (
            <div className="grid grid-cols-2 gap-4">
              <Input label="Invoice Number" value={row.invoice_number || ''} onChange={e => onChange({ invoice_number: e.target.value })} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input label="Supplier GSTIN" value={row.supplier_gstin || ''} onChange={e => onChange({ supplier_gstin: e.target.value })} />
            <Input label="Recipient GSTIN" value={row.recipient_gstin || ''} onChange={e => onChange({ recipient_gstin: e.target.value })} />
          </div>
        </div>
      )}

      <div className="border-t border-border pt-4 space-y-4">
        <h4 className="font-semibold">E-Way Bill</h4>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={row.eway_status === 'already_have'} onChange={() => onChange({ eway_status: 'already_have' })} /><span className="text-sm">Already have one</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={row.eway_status === 'provide_later'} onChange={() => onChange({ eway_status: 'provide_later' })} /><span className="text-sm">Provide later</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={row.eway_status === 'not_applicable'} onChange={() => onChange({ eway_status: 'not_applicable' })} /><span className="text-sm">Not applicable</span></label>
        </div>
        {row.eway_status === 'already_have' && (
          <div className="w-1/2 mt-2">
            <Input label="E-Way Bill Number" value={row.eway_number || ''} onChange={e => onChange({ eway_number: e.target.value })} />
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="font-semibold mb-3">Handling</h4>
        <p className="mb-2 text-sm font-semibold">Special Handling</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {HANDLING_OPTIONS.map(h => (
            <Checkbox
              key={h.id} label={h.label} checked={row.handling.includes(h.id as any)}
              onChange={e => onChange({ handling: e.target.checked ? [...row.handling, h.id as any] : row.handling.filter(x => x !== h.id) })}
            />
          ))}
        </div>
        <Input label="Special Instructions" placeholder="Optional" value={row.special_instructions || ''} onChange={e => onChange({ special_instructions: e.target.value })} />
      </div>

    </Card>
  )
}
