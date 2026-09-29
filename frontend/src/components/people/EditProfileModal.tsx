import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { depotsAPI, peopleAPI, tplAPI } from '@/services/api'
import { Alert, Button, Input, Modal, PlaceSearch, Select, useConfirm } from '@/components/ui'
import { liveDocuments } from './docs'
import { dobError } from './validators'
import type { ResolvedPlace } from '@/services/geocoding'
import { errorMessage } from '@/utils/display'
import { EMPLOYMENT_OPTIONS, STAFF_ROLES, isEmail, personName, roleLabel, toE164, type PersonDetail } from './types'

const GENDERS = [
  { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' },
]
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(v => ({ value: v, label: v }))

const blank = (v: string) => (v.trim() === '' ? null : v.trim())

/** Edit basics, personal details, address and employment in one form. */
export function EditProfileModal({ detail, open, onClose }: { detail: PersonDetail; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { user, profile } = detail
  const [conflict, setConflict] = useState(false)
  const isDriver = user.role === 'driver'
  const [f, setF] = useState<Record<string, string>>({})
  const [place, setPlace] = useState<ResolvedPlace | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    const p = profile ?? {}
    setF({
      full_name: user.full_name ?? '', email: user.email ?? '',
      alternate_phone: p.alternate_phone ?? '', personal_email: p.personal_email ?? '',
      date_of_birth: p.date_of_birth ?? '', gender: p.gender ?? '', blood_group: p.blood_group ?? '',
      address_line: p.address_line ?? '', city: p.city ?? '', state: p.state ?? '', pincode: p.pincode ?? '',
      employee_code: p.employee_code ?? '', designation: p.designation ?? '', department: p.department ?? '',
      employment_type: p.employment_type ?? '', date_of_joining: p.date_of_joining ?? '',
      reporting_manager_id: p.reporting_manager_id ?? '', base_depot_id: p.base_depot_id ?? '',
      employer_type: p.employer_type ?? 'company', employer_partner_id: p.employer_partner_id ?? '',
    })
    setConflict(false)
    setPlace(p.address_line && p.latitude != null && p.longitude != null ? { address: p.address_line, lat: p.latitude, lng: p.longitude } : null)
    setErrors({})
  }, [open, user, profile])

  const set = (k: string) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }))

  const people = useQuery({ queryKey: ['people', 'managers'], queryFn: () => peopleAPI.list({ limit: 500 }), enabled: open })
  const partners = useQuery({
    queryKey: ['tpl-queue', 'all'],
    queryFn: () => tplAPI.queue('all').then((d: unknown) => (Array.isArray(d) ? d as { id: string; company_name: string; status: string }[] : [])),
    enabled: open && isDriver,
  })
  const depots = useQuery({ queryKey: ['depots'], queryFn: depotsAPI.list, enabled: open })
  const managerOptions = useMemo(
    () => (people.data ?? []).filter(p => STAFF_ROLES.includes(p.role) && p.id !== user.id && p.status !== 'inactive')
      .map(p => ({ value: p.id, label: `${personName(p)} · ${roleLabel(p.role)}` })),
    [people.data, user.id],
  )

  const pickPlace = (p: ResolvedPlace | null) => {
    setPlace(p)
    if (!p) return
    setF(s => ({
      ...s, address_line: p.address,
      city: p.parts?.city ?? s.city, state: p.parts?.state ?? s.state, pincode: p.parts?.pincode ?? s.pincode,
    }))
  }

  const save = useMutation({
    mutationFn: () => peopleAPI.update(user.id, {
      full_name: f.full_name.trim(),
      updated_at: profile?.updated_at,
      email: blank(f.email),
      profile: {
        alternate_phone: f.alternate_phone.trim() ? toE164(f.alternate_phone) : null,
        personal_email: blank(f.personal_email),
        date_of_birth: blank(f.date_of_birth), gender: blank(f.gender), blood_group: blank(f.blood_group),
        address_line: blank(f.address_line), city: blank(f.city), state: blank(f.state), pincode: blank(f.pincode),
        latitude: place?.lat ?? null, longitude: place?.lng ?? null,
        employee_code: blank(f.employee_code), designation: blank(f.designation), department: blank(f.department),
        employment_type: blank(f.employment_type), date_of_joining: blank(f.date_of_joining),
        reporting_manager_id: blank(f.reporting_manager_id), base_depot_id: blank(f.base_depot_id),
        ...(isDriver ? { employer_type: f.employer_type, employer_partner_id: f.employer_type === 'partner' ? blank(f.employer_partner_id) : null } : {}),
      },
    }),
    onSuccess: () => {
      toast.success('Profile saved')
      queryClient.invalidateQueries({ queryKey: ['people'] })
      onClose()
    },
    onError: err => {
      if ((err as { response?: { status?: number } })?.response?.status === 409) setConflict(true)
      else toast.error(errorMessage(err, 'We could not save the profile. Check the details and try again.'))
    },
  })

  const licence = liveDocuments(detail.documents).find(d => d.doc_type === 'driving_licence')
  const licenceClasses = Array.isArray(licence?.metadata?.licence_classes) ? (licence!.metadata!.licence_classes as string[]) : []

  const submit = async () => {
    const e: Record<string, string> = {}
    if (!f.full_name.trim()) e.full_name = 'Enter their full name.'
    const dob = dobError(f.date_of_birth, licenceClasses)
    if (dob) e.date_of_birth = dob
    if (isDriver && f.employer_type === 'partner' && !f.employer_partner_id) e.employer_partner_id = 'Choose the partner.'
    if (f.alternate_phone.trim() && !toE164(f.alternate_phone)) e.alternate_phone = 'Enter a 10-digit mobile number.'
    if (f.email.trim() && !isEmail(f.email)) e.email = 'Enter a valid email.'
    if (f.personal_email.trim() && !isEmail(f.personal_email)) e.personal_email = 'Enter a valid email.'
    if (f.pincode.trim() && !/^\d{6}$/.test(f.pincode.trim())) e.pincode = 'PIN code is 6 digits.'
    setErrors(e)
    if (Object.keys(e).length > 0) return
    if (!isDriver && f.email.trim() !== (user.email ?? '')) {
      const ok = await confirm({
        title: 'Change the sign-in email?',
        message: `${personName(user)} signs in with this address. We send a confirmation to ${f.email.trim()}, and they must confirm it before it works. Until then they keep signing in with the old one.`,
        confirmLabel: 'Change email',
      })
      if (!ok) return
    }
    save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit profile"
      description={personName(user)}
      size="lg"
      closeOnBackdrop={!save.isPending}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save profile</Button>
        </>
      }
    >
      <div className="space-y-6">
        {conflict && (
          <Alert tone="danger" title="Someone else changed this profile"
            action={<Button size="sm" onClick={() => { queryClient.invalidateQueries({ queryKey: ['people'] }); onClose() }}>Reload profile</Button>}>
            Reload to see their changes, then make your edit again.
          </Alert>
        )}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-text">Basics</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Full name" required value={f.full_name ?? ''} onChange={set('full_name')} error={errors.full_name} data-autofocus />
            <Input label="Work email" type="email" value={f.email ?? ''} onChange={set('email')} error={errors.email}
              hint={isDriver ? undefined : 'Changing it sends a confirmation to the new address.'} />
            <Input label="Mobile number" value={user.phone ?? 'Not set'} readOnly disabled hint="Use Change phone on the profile to change it." />
            <Input label="Alternate mobile" type="tel" inputMode="numeric" value={f.alternate_phone ?? ''} onChange={set('alternate_phone')} error={errors.alternate_phone} />
            <Input label="Personal email" type="email" value={f.personal_email ?? ''} onChange={set('personal_email')} error={errors.personal_email} />
            <Input label="Date of birth" type="date" value={f.date_of_birth ?? ''} onChange={set('date_of_birth')} error={errors.date_of_birth} />
            <Select label="Gender" value={f.gender ?? ''} onChange={set('gender')} placeholder="Not set" options={GENDERS} />
            <Select label="Blood group" value={f.blood_group ?? ''} onChange={set('blood_group')} placeholder="Not set" options={BLOOD_GROUPS} />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-text">Address</h3>
          <PlaceSearch label="Find address" value={place} onChange={pickPlace} hint="Pick a match to fill the address, city, state and PIN code." />
          <Input label="Address" value={f.address_line ?? ''} onChange={set('address_line')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="City" value={f.city ?? ''} onChange={set('city')} />
            <Input label="State" value={f.state ?? ''} onChange={set('state')} />
            <Input label="PIN code" inputMode="numeric" maxLength={6} value={f.pincode ?? ''} onChange={set('pincode')} error={errors.pincode} />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-text">Employment</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Employee code" value={f.employee_code ?? ''} onChange={set('employee_code')} />
            <Input label="Designation" value={f.designation ?? ''} onChange={set('designation')} />
            <Input label="Department" value={f.department ?? ''} onChange={set('department')} />
            <Select label="Employment type" value={f.employment_type ?? ''} onChange={set('employment_type')} placeholder="Not set" options={EMPLOYMENT_OPTIONS} />
            <Input label="Date of joining" type="date" value={f.date_of_joining ?? ''} onChange={set('date_of_joining')} />
            <Select label="Base depot" value={f.base_depot_id ?? ''} onChange={set('base_depot_id')} placeholder="Not set"
              options={(depots.data ?? []).map(d => ({ value: d.id, label: d.name }))} />
            {isDriver && (
              <>
                <Select label="Works for" value={f.employer_type ?? 'company'} onChange={set('employer_type')}
                  options={[{ value: 'company', label: 'Our company' }, { value: 'partner', label: 'A 3PL partner' }]} />
                {f.employer_type === 'partner' && (
                  <Select label="Partner" required value={f.employer_partner_id ?? ''} onChange={set('employer_partner_id')} error={errors.employer_partner_id}
                    placeholder={partners.isLoading ? 'Loading' : 'Choose a partner'}
                    options={(partners.data ?? []).filter(p => p.status === 'active' || p.id === profile?.employer_partner_id).map(p => ({ value: p.id, label: p.company_name }))} />
                )}
              </>
            )}
            <Select label="Reports to" className="sm:col-span-2" value={f.reporting_manager_id ?? ''} onChange={set('reporting_manager_id')} placeholder="Nobody" options={managerOptions} />
          </div>
        </section>
      </div>
    </Modal>
  )
}
