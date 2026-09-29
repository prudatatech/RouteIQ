import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { depotsAPI, peopleAPI, tplAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { Alert, Button, Input, Modal, Select } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { DuplicateNotice } from './DuplicateNotice'
import { useDuplicates } from './useDuplicates'
import { EMPLOYMENT_OPTIONS, STAFF_ROLES, isEmail, personName, roleLabel, toE164 } from './types'

type Step = 'role' | 'basics' | 'employment' | 'done'
const STEP_ORDER: Step[] = ['role', 'basics', 'employment', 'done']
const STEP_LABEL: Record<Step, string> = { role: 'Role', basics: 'Basics', employment: 'Employment', done: 'Done' }

const ROLE_HELP: Record<string, string> = {
  driver: 'Drives a vehicle and uses the driver app.',
  manager: 'Dispatches and monitors. Cannot manage other people.',
  admin: 'Manages people, fleet and settings.',
  superadmin: 'Full access, including bank details and other admins.',
}

/** Steps: role, basics, employment (optional), done. Opens the new profile at the end. */
export function AddPersonModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const myRole = useAuthStore(s => s.role)
  const [step, setStep] = useState<Step>('role')
  const [role, setRole] = useState('driver')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [designation, setDesignation] = useState('')
  const [department, setDepartment] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [joined, setJoined] = useState('')
  const [managerId, setManagerId] = useState('')
  const [depotId, setDepotId] = useState('')
  const [employer, setEmployer] = useState<'company' | 'partner'>('company')
  const [partnerId, setPartnerId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [createdId, setCreatedId] = useState<string | null>(null)

  const isDriver = role === 'driver'
  const roles = ['driver', 'manager', 'admin', ...(myRole === 'superadmin' ? ['superadmin'] : [])]

  const managers = useQuery({
    queryKey: ['people', 'managers'],
    queryFn: () => peopleAPI.list({ limit: 500 }),
    enabled: open && step === 'employment',
  })
  const partners = useQuery({
    queryKey: ['tpl-queue', 'all'],
    queryFn: () => tplAPI.queue('all').then((d: unknown) => (Array.isArray(d) ? d as { id: string; company_name: string; status: string }[] : [])),
    enabled: open && step === 'employment' && isDriver,
  })
  const phoneE164 = toE164(phone)
  const dup = useDuplicates({ phone: phoneE164 ?? undefined }, open && step === 'basics' && !!phoneE164)
  const depots = useQuery({ queryKey: ['depots'], queryFn: depotsAPI.list, enabled: open && step === 'employment' })
  const managerOptions = useMemo(
    () => (managers.data ?? []).filter(p => STAFF_ROLES.includes(p.role) && p.status !== 'inactive')
      .map(p => ({ value: p.id, label: `${personName(p)} · ${roleLabel(p.role)}` })),
    [managers.data],
  )

  const reset = () => {
    setStep('role'); setRole('driver'); setFullName(''); setPhone(''); setEmail(''); setEmployeeCode(''); setDesignation('')
    setDepartment(''); setEmploymentType(''); setJoined(''); setManagerId(''); setDepotId(''); setEmployer('company'); setPartnerId(''); setErrors({}); setCreatedId(null)
  }
  const close = () => { reset(); onClose() }

  const create = useMutation({
    mutationFn: () => {
      const profile: Record<string, unknown> = {}
      if (employeeCode.trim()) profile.employee_code = employeeCode.trim()
      if (designation.trim()) profile.designation = designation.trim()
      if (department.trim()) profile.department = department.trim()
      if (employmentType) profile.employment_type = employmentType
      if (joined) profile.date_of_joining = joined
      if (managerId) profile.reporting_manager_id = managerId
      if (depotId) profile.base_depot_id = depotId
      if (isDriver) {
        profile.employer_type = employer
        if (employer === 'partner') profile.employer_partner_id = partnerId
      }
      return peopleAPI.create({
        role,
        full_name: fullName.trim(),
        ...(isDriver ? { phone: toE164(phone) ?? undefined } : { email: email.trim() }),
        ...(!isDriver && phone.trim() && toE164(phone) ? { phone: toE164(phone)! } : {}),
        ...(Object.keys(profile).length ? { profile } : {}),
      })
    },
    onSuccess: res => {
      setCreatedId(res.id ?? res.user?.id ?? null)
      setStep('done')
      queryClient.invalidateQueries({ queryKey: ['people'] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not add this person. Check the details and try again.')),
  })

  const next = () => {
    if (step === 'role') { setStep('basics'); return }
    if (step === 'basics') {
      const e: Record<string, string> = {}
      if (!fullName.trim()) e.fullName = 'Enter their full name.'
      if (isDriver && !toE164(phone)) e.phone = 'Enter a 10-digit mobile number.'
      if (!isDriver && !isEmail(email)) e.email = 'Enter a valid work email.'
      if (phoneE164 && dup.matches.length > 0) e.phone = 'This number already belongs to someone on file.'
      setErrors(e)
      if (Object.keys(e).length === 0) setStep('employment')
      return
    }
    if (step === 'employment') {
      if (isDriver && employer === 'partner' && !partnerId) { setErrors({ partner: 'Choose the partner.' }); return }
      setErrors({})
      create.mutate()
    }
  }
  const back = () => setStep(STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(step) - 1)])

  const footer = step === 'done' ? (
    <>
      <Button variant="secondary" onClick={close}>Close</Button>
      {createdId && <Button onClick={() => { const id = createdId; close(); navigate(`/admin/users/${id}`) }}>Open profile</Button>}
    </>
  ) : (
    <>
      {step === 'role' ? <Button variant="secondary" onClick={close}>Cancel</Button> : <Button variant="secondary" onClick={back} disabled={create.isPending}>Back</Button>}
      <Button type="submit" loading={create.isPending}>{step === 'employment' ? 'Add person' : 'Next'}</Button>
    </>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Add person"
      description={step === 'done' ? undefined : `Step ${STEP_ORDER.indexOf(step) + 1} of 3: ${STEP_LABEL[step]}`}
      closeOnBackdrop={false}
      footer={footer}
      onSubmit={step === 'done' ? undefined : next}
    >
      {step === 'role' && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-text">What will they do?</legend>
          {roles.map(r => (
            <label
              key={r}
              className={clsx('flex cursor-pointer items-start gap-3 rounded-control border p-3 focus-within:outline focus-within:outline-2 focus-within:outline-brand',
                role === r ? 'border-brand bg-brand-soft' : 'border-border bg-surface')}
            >
              <input type="radio" name="person-role" className="mt-1" checked={role === r} onChange={() => setRole(r)} />
              <span>
                <span className="block text-sm font-medium text-text">{roleLabel(r)}</span>
                <span className="block text-xs text-muted">{ROLE_HELP[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 'basics' && (
        <div className="space-y-4">
          <Input label="Full name" required data-autofocus value={fullName} onChange={e => setFullName(e.target.value)} error={errors.fullName} autoComplete="off" />
          {isDriver ? (
            <Input label="Mobile number" required type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)}
              error={errors.phone} hint="10-digit number. They sign in to the driver app with a one-time code sent to this number." />
          ) : (
            <>
              <Input label="Work email" required type="email" value={email} onChange={e => setEmail(e.target.value)} error={errors.email} autoComplete="off"
                hint="They get an email invite to set their own password." />
              <Input label="Mobile number" type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} hint="Optional." />
            </>
          )}
          <DuplicateNotice matches={dup.matches} what="mobile number" onNavigate={close} />
          <Alert tone="info">
            {isDriver
              ? 'No password is needed. The driver opens the driver app, enters this number and the code they receive, and lands on this record.'
              : 'We send an invite to this email. Nobody else ever sees their password.'}
          </Alert>
        </div>
      )}

      {step === 'employment' && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Optional. You can fill this in later from their profile.</p>
          {isDriver && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Works for" value={employer} onChange={e => setEmployer(e.target.value as 'company' | 'partner')}
                options={[{ value: 'company', label: 'Our company' }, { value: 'partner', label: 'A 3PL partner' }]}
                hint={employer === 'partner' ? 'The partner pays them, so no bank details are kept here.' : undefined} />
              {employer === 'partner' && (
                <Select label="Partner" required value={partnerId} onChange={e => setPartnerId(e.target.value)} error={errors.partner}
                  placeholder={partners.isLoading ? 'Loading' : 'Choose a partner'}
                  options={(partners.data ?? []).filter(p => p.status === 'active').map(p => ({ value: p.id, label: p.company_name }))} />
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Employee code" value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} />
            <Input label="Designation" value={designation} onChange={e => setDesignation(e.target.value)} />
            <Input label="Department" value={department} onChange={e => setDepartment(e.target.value)} />
            <Select label="Employment type" value={employmentType} onChange={e => setEmploymentType(e.target.value)}
              placeholder="Not set" options={EMPLOYMENT_OPTIONS} />
            <Input label="Date of joining" type="date" value={joined} onChange={e => setJoined(e.target.value)} />
            <Select label="Base depot" value={depotId} onChange={e => setDepotId(e.target.value)} placeholder="Not set"
              options={(depots.data ?? []).map(d => ({ value: d.id, label: d.name }))} />
          </div>
          <Select label="Reports to" value={managerId} onChange={e => setManagerId(e.target.value)} placeholder={managers.isLoading ? 'Loading' : 'Nobody'}
            options={managerOptions} />
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true"><CheckCircle2 size={24} /></span>
          <p className="text-base font-semibold text-text">{fullName.trim()} has been added</p>
          <p className="max-w-sm text-sm text-muted">
            {isDriver
              ? 'They can now sign in to the driver app with a one-time code sent to their mobile number.'
              : 'An invite is on its way to their email so they can set a password.'}
            {' '}Next, upload their documents from their profile.
          </p>
        </div>
      )}
    </Modal>
  )
}
