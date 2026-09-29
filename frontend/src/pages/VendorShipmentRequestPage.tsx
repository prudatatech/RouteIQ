import { errorMessage } from '@/utils/display'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Sparkles, Warehouse } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { vendorAPI } from '@/services/api'
import { searchHSN, type HSNEntry } from '@/utils/hsnDatabase'
import { MapView, type MapPoint, type MapRoute } from '@/components/map'
import AddressPicker from '@/components/map/AddressPicker'
import {
  Button, Card, Checkbox, Input, Page, PageHeader, Select, Textarea,
} from '@/components/ui'
import type { ResolvedPlace } from '@/services/geocoding'

const PRODUCT_CATEGORIES = ['FMCG', 'Electronics', 'Textile', 'Steel', 'Cement', 'Agriculture', 'Chemicals', 'Furniture', 'Automobile parts', 'Machinery']
  .map(v => ({ value: v, label: v }))
const PACKAGING_TYPES = ['Box', 'Carton', 'Bag', 'Drum', 'Pallet', 'Roll', 'Loose', 'Bundle', 'Container'].map(v => ({ value: v, label: v }))
const UNITS = ['Kg', 'Ton', 'Piece', 'Box', 'Bag', 'Drum', 'Litre', 'Roll', 'Carton'].map(v => ({ value: v, label: v }))
const SPECIAL_HANDLING = [
  { id: 'fragile', label: 'Fragile' },
  { id: 'hazardous', label: 'Hazardous' },
  { id: 'coldChain', label: 'Cold chain' },
  { id: 'stackable', label: 'Stackable' },
  { id: 'highValue', label: 'High value' },
] as const

const STEPS = ['Route', 'Cargo', 'Review'] as const

interface VendorProfileLite {
  company_name?: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

export default function VendorShipmentRequestPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const token = useAuthStore(s => s.token)

  const [step, setStep] = useState(0)
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [vendorProfile, setVendorProfile] = useState<VendorProfileLite | null>(null)

  const [pickup, setPickup] = useState<ResolvedPlace | null>(null)
  const [drop, setDrop] = useState<ResolvedPlace | null>(null)

  const [consigneeName, setConsigneeName] = useState('')
  const [consigneeContact, setConsigneeContact] = useState('')
  const [consigneeEmail, setConsigneeEmail] = useState('')

  const [productCategory, setProductCategory] = useState('')
  const [productName, setProductName] = useState('')
  const [brand, setBrand] = useState('')
  const [modelVariant, setModelVariant] = useState('')

  const [packagingType, setPackagingType] = useState('')
  const [noOfPackages, setNoOfPackages] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [capacity, setCapacity] = useState('')
  const [declaredValue, setDeclaredValue] = useState('')

  const [hsnCode, setHsnCode] = useState('')
  const [hsnDescription, setHsnDescription] = useState('')
  const [gstRate, setGstRate] = useState('')
  const [hsnSuggestions, setHsnSuggestions] = useState<HSNEntry[]>([])
  const [showHsnDropdown, setShowHsnDropdown] = useState(false)
  const hsnDropdownRef = useRef<HTMLDivElement>(null)

  const [specialHandling, setSpecialHandling] = useState<Record<string, boolean>>({})
  const [remarks, setRemarks] = useState('')

  // Restore a pending request after sign-in, or seed the drop location from a link elsewhere in the app.
  useEffect(() => {
    let restored = false
    if (token) {
      const pending = sessionStorage.getItem('pendingMapRequest')
      if (pending) {
        try {
          const data = JSON.parse(pending)
          setPickup(data.pickup ?? null)
          setDrop(data.drop ?? null)
          setCapacity(data.capacity ? String(data.capacity) : '')
        } catch { /* ignore malformed session data */ }
        sessionStorage.removeItem('pendingMapRequest')
        restored = true
      }
    }
    if (!restored) {
      const params = new URLSearchParams(location.search)
      const query = params.get('query')
      const lat = params.get('lat')
      const lng = params.get('lng')
      if (query && lat && lng) {
        setDrop({ address: query, lat: parseFloat(lat), lng: parseFloat(lng) })
      }
    }
    if (token) {
      vendorAPI.profile().then(setVendorProfile).catch(err => console.warn('Failed to load vendor profile', err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    const query = hsnCode || productName
    if (query && query.length >= 2) {
      const results = searchHSN(query, productCategory)
      setHsnSuggestions(results)
      if (results.length > 0 && !hsnCode) setShowHsnDropdown(true)
    } else {
      setHsnSuggestions([])
    }
  }, [hsnCode, productName, productCategory])

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (hsnDropdownRef.current && !hsnDropdownRef.current.contains(e.target as Node)) setShowHsnDropdown(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  const selectHSN = (entry: HSNEntry) => {
    setHsnCode(entry.hsn)
    setHsnDescription(entry.description)
    setGstRate(String(entry.gstRate))
    setShowHsnDropdown(false)
  }

  const useWarehouse = () => {
    if (vendorProfile?.address && vendorProfile.latitude != null && vendorProfile.longitude != null) {
      setPickup({ address: vendorProfile.address, lat: vendorProfile.latitude, lng: vendorProfile.longitude })
      toast.success('Warehouse address selected')
    } else {
      toast.error('No warehouse address on file yet. Add one under Company & KYC.')
    }
  }

  const onPointMove = (id: string, pos: { lat: number; lng: number }) => {
    const address = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`
    if (id === 'pickup') setPickup({ address, ...pos })
    else if (id === 'drop') setDrop({ address, ...pos })
  }

  const mapPoints: MapPoint[] = [
    pickup && { id: 'pickup', kind: 'pickup', label: `Pickup: ${pickup.address}`, position: pickup, radiusKm: 5, draggable: true },
    drop && { id: 'drop', kind: 'drop', label: `Drop: ${drop.address}`, position: drop, radiusKm: 5, draggable: true },
  ].filter(Boolean) as MapPoint[]
  const mapRoute: MapRoute | null = pickup && drop
    ? { coordinates: [[pickup.lng, pickup.lat], [drop.lng, drop.lat]], planned: true }
    : null

  const stepErrors = useMemo(() => {
    const errors: Record<number, Record<string, string>> = { 0: {}, 1: {}, 2: {} }
    if (!pickup) errors[0].pickup = 'Search or pick a pickup location'
    if (!drop) errors[0].drop = 'Search or pick a drop location'
    if (!consigneeContact.trim() && !consigneeEmail.trim()) {
      errors[1].consigneeContact = 'Enter a contact number or email'
      errors[1].consigneeEmail = 'Enter a contact number or email'
    } else {
      if (consigneeContact.trim() && !/^[6-9]\d{9}$/.test(consigneeContact.trim())) {
        errors[1].consigneeContact = 'Enter a valid 10-digit mobile number'
      }
      if (consigneeEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(consigneeEmail.trim())) {
        errors[1].consigneeEmail = 'Enter a valid email address'
      }
    }
    if (!productCategory) errors[1].productCategory = 'Choose a product category'
    if (!productName.trim()) errors[1].productName = 'Enter the product name'
    if (!capacity || Number(capacity) <= 0) errors[1].capacity = 'Enter the gross weight'
    return errors
  }, [pickup, drop, consigneeContact, consigneeEmail, productCategory, productName, capacity])

  const stepValid = (i: number) => Object.keys(stepErrors[i]).length === 0
  const err = (i: number, key: string) => (attempted[i] ? stepErrors[i][key] : undefined)
  const missingSummary = [...Object.values(stepErrors[0]), ...Object.values(stepErrors[1])]

  const goNext = () => {
    setAttempted(prev => ({ ...prev, [step]: true }))
    if (!stepValid(step)) return
    setStep(s => Math.min(STEPS.length - 1, s + 1))
    window.scrollTo(0, 0)
  }
  const goBack = () => { setStep(s => Math.max(0, s - 1)); window.scrollTo(0, 0) }

  const submit = async () => {
    setAttempted({ 0: true, 1: true, 2: true })
    if (!stepValid(0) || !stepValid(1) || !pickup || !drop) return

    const payload = {
      pickup,
      drop,
      capacity: Number(capacity),
      metadata: {
        consignee: { name: consigneeName, contact: consigneeContact, email: consigneeEmail },
        cargo: {
          category: productCategory,
          name: productName,
          brand,
          modelVariant,
          hsnCode,
          hsnDescription,
          gstRate: gstRate ? Number(gstRate) : null,
          packagingType,
          noOfPackages: Number(noOfPackages) || 0,
          quantity: Number(quantity) || 0,
          unit,
          grossWeightKg: Number(capacity),
          declaredValue,
          specialHandling,
          remarks,
        },
      },
    }

    if (!token) {
      sessionStorage.setItem('pendingMapRequest', JSON.stringify(payload))
      toast('Sign in to post this load — we will bring you right back.', { icon: '🔒' })
      navigate(`/login?as=vendor&next=${encodeURIComponent('/vendor/request')}`)
      return
    }

    setIsSubmitting(true)
    try {
      await vendorAPI.createShipmentRequest(payload)
      toast.success('Shipment request created')
      navigate('/vendor/shipments')
    } catch (err) {
      const message = errorMessage(err, 'Please try again.')
      toast.error(`Failed to submit request: ${message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Post a load"
        description="Tell us the route and cargo — we'll match it with available capacity."
        back={{ to: '/vendor', label: 'Back to find capacity' }}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((label, i) => (
          <span key={label} className="flex items-center gap-2">
            <span className={i === step ? 'font-medium text-text' : i < step ? 'text-brand' : 'text-muted'}>
              {i + 1}. {label}
            </span>
            {i < STEPS.length - 1 && <span className="text-border">/</span>}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card padded className={step === 0 ? 'space-y-6 lg:col-span-5' : 'space-y-6 lg:col-span-3'}>
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">Pickup location <span className="text-danger">*</span></p>
                <Button type="button" variant="secondary" size="sm" icon={<Warehouse size={14} />} onClick={useWarehouse}>Warehouse</Button>
              </div>
              <AddressPicker
                label="" value={pickup} onChange={setPickup} placeholder="Search pickup address"
                error={err(0, 'pickup')} showMap={false} kind="pickup"
              />

              <AddressPicker
                label="Drop location" required value={drop} onChange={setDrop} placeholder="Search drop address"
                error={err(0, 'drop')} showMap={false} kind="drop"
              />

              <div className="overflow-hidden rounded-card border border-border">
                <MapView mode="picker" height={280} points={mapPoints} route={mapRoute} onPointMove={onPointMove} />
              </div>
              <p className="text-xs text-muted">Drag a pin above to fine-tune the pickup or drop point, or use "Use my location" on either field. The dashed line and shaded circles show the 5&nbsp;km match radius.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <p className="mb-3 text-sm font-medium text-text">Consignee (receiver)</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Name" value={consigneeName} onChange={e => setConsigneeName(e.target.value)} />
                  <Input
                    label="Contact number" type="tel" inputMode="tel" maxLength={10}
                    value={consigneeContact} onChange={e => setConsigneeContact(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    error={err(1, 'consigneeContact')}
                    hint="Give a phone number or email below"
                  />
                  <div className="sm:col-span-2">
                    <Input label="Email address" type="email" value={consigneeEmail} onChange={e => setConsigneeEmail(e.target.value)} error={err(1, 'consigneeEmail')} />
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-text">Product</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Select label="Category" required options={PRODUCT_CATEGORIES} placeholder="Select a category" value={productCategory} onChange={e => setProductCategory(e.target.value)} error={err(1, 'productCategory')} />
                  <Input label="Product name" required value={productName} onChange={e => setProductName(e.target.value)} error={err(1, 'productName')} />
                  <Input label="Brand" value={brand} onChange={e => setBrand(e.target.value)} />
                  <Input label="Model / variant" value={modelVariant} onChange={e => setModelVariant(e.target.value)} />
                </div>
              </div>

              <div ref={hsnDropdownRef} className="relative space-y-3 rounded-card border border-border p-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-brand" />
                  <p className="text-sm font-medium text-text">HSN classification <span className="font-normal text-muted">(auto-suggest)</span></p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="relative">
                    <Input
                      label="HSN code" value={hsnCode}
                      onChange={e => { setHsnCode(e.target.value); setShowHsnDropdown(true) }}
                      onFocus={() => { if (hsnSuggestions.length > 0) setShowHsnDropdown(true) }}
                      placeholder="e.g. 1006 or type the product"
                    />
                    {showHsnDropdown && hsnSuggestions.length > 0 && (
                      <ul className="absolute z-20 mt-1 w-[280px] max-h-64 overflow-y-auto rounded-control border border-border bg-surface shadow-raised">
                        {hsnSuggestions.map((entry, i) => (
                          <li key={`${entry.hsn}-${i}`}>
                            <button type="button" onClick={() => selectHSN(entry)} className="w-full px-3 py-2 text-left hover:bg-surface-subtle">
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium text-text">{entry.hsn}</span>
                                <span className="text-xs text-success">{entry.gstRate}% GST</span>
                              </div>
                              <div className="text-xs text-muted">{entry.description}</div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Input label="Description" value={hsnDescription} onChange={e => setHsnDescription(e.target.value)} />
                  <Input label="GST rate (%)" value={gstRate} onChange={e => setGstRate(e.target.value.replace('%', ''))} />
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-text">Packaging & quantity</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Select label="Packaging" options={PACKAGING_TYPES} placeholder="Select type" value={packagingType} onChange={e => setPackagingType(e.target.value)} />
                  <Input label="No. of packages" type="number" value={noOfPackages} onChange={e => setNoOfPackages(e.target.value)} />
                  <Input label="Quantity" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
                  <Select label="Unit" options={UNITS} placeholder="Select unit" value={unit} onChange={e => setUnit(e.target.value)} />
                  <Input label="Gross weight (kg)" type="number" required value={capacity} onChange={e => setCapacity(e.target.value)} error={err(1, 'capacity')} />
                  <Input label="Declared value (₹)" type="number" value={declaredValue} onChange={e => setDeclaredValue(e.target.value)} />
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-text">Special handling</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {SPECIAL_HANDLING.map(opt => (
                    <Checkbox
                      key={opt.id}
                      label={opt.label}
                      checked={!!specialHandling[opt.id]}
                      onChange={e => setSpecialHandling(s => ({ ...s, [opt.id]: e.target.checked }))}
                    />
                  ))}
                </div>
              </div>

              <Textarea label="Remarks" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Handling instructions, delivery notes…" />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <ReviewSection title="Route" rows={[
                ['Pickup', pickup?.address ?? '—'],
                ['Drop', drop?.address ?? '—'],
              ]} />
              <ReviewSection title="Cargo" rows={[
                ['Category', productCategory || '—'],
                ['Product', [productName, brand].filter(Boolean).join(' · ') || '—'],
                ['HSN code', hsnCode || '—'],
                ['Gross weight', capacity ? `${Number(capacity).toLocaleString('en-IN')} kg` : '—'],
                ['Declared value', declaredValue ? `₹${Number(declaredValue).toLocaleString('en-IN')}` : '—'],
              ]} />
              <ReviewSection title="Consignee" rows={[
                ['Name', consigneeName || '—'],
                ['Contact', [consigneeContact, consigneeEmail].filter(Boolean).join(' · ') || '—'],
              ]} />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={goBack} disabled={step === 0}>Back</Button>
            <div className="flex flex-col items-end gap-1">
              {attempted[step] && missingSummary.length > 0 && step < STEPS.length - 1 && (
                <p className="text-xs text-danger">{missingSummary[0]}</p>
              )}
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={goNext}>Continue</Button>
              ) : (
                <Button type="button" onClick={submit} loading={isSubmitting}>Submit request</Button>
              )}
            </div>
          </div>
        </Card>

        {step !== 0 && (
          <div className="hidden lg:col-span-2 lg:block">
            <div className="sticky top-6 overflow-hidden rounded-card border border-border">
              <MapView mode="picker" height={420} points={mapPoints} route={mapRoute} onPointMove={onPointMove} interactive={step !== 2} />
            </div>
          </div>
        )}
      </div>
    </Page>
  )
}

function ReviewSection({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-text">{title}</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-card border border-border p-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 break-words text-sm text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
