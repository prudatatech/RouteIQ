import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { peopleAPI } from '@/services/api'
import { Button, Card, CardBody, CardHeader, ErrorState, Input, Select, Skeleton } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import type { EnforcementMode, PeopleSettings } from './types'

export const ENFORCEMENT_OPTIONS: { value: EnforcementMode; label: string }[] = [
  { value: 'off', label: 'Off: no checks' },
  { value: 'warn', label: 'Warn: show a warning, allow the assignment' },
  { value: 'block', label: 'Block: refuse the assignment' },
]
const ENFORCEMENT_HELP: Record<EnforcementMode, string> = {
  off: 'Dispatch does not look at driver documents.',
  warn: 'Dispatch sees "Driver licence expired" and similar next to the vehicle, but can still assign it.',
  block: 'Dispatch cannot assign a vehicle whose driver has an expired (after grace), missing or wrong-class licence, or is not active.',
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v))

/** Rules for driver documents and bank changes (docs/people-plan.md, "Extra schema"). */
export function PeopleSettingsCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['people', 'settings'], queryFn: peopleAPI.settings })
  const [grace, setGrace] = useState('')
  const [retention, setRetention] = useState('')
  const [cooldown, setCooldown] = useState('')
  const [mode, setMode] = useState<EnforcementMode>('warn')
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const d = settings.data
    if (!d) return
    setGrace(String(d.licence_grace_days)); setRetention(String(d.document_retention_days))
    setCooldown(String(d.bank_change_cooldown_hours)); setMode(d.driver_document_enforcement)
  }, [settings.data])

  const save = useMutation({
    mutationFn: (v: PeopleSettings) => peopleAPI.saveSettings(v),
    onSuccess: data => { toast.success('People settings saved'); queryClient.setQueryData(['people', 'settings'], data) },
    onError: err => toast.error(errorMessage(err, 'We could not save these settings. Try again.')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    const g = num(grace), r = num(retention), c = num(cooldown)
    if (!Number.isInteger(g) || g < 0 || g > 365) err.grace = 'Enter whole days from 0 to 365.'
    if (!Number.isInteger(r) || r < 30 || r > 3650) err.retention = 'Enter whole days from 30 to 3650.'
    if (!Number.isInteger(c) || c < 0 || c > 720) err.cooldown = 'Enter whole hours from 0 to 720.'
    setErrors(err)
    if (Object.keys(err).length === 0) save.mutate({ licence_grace_days: g, document_retention_days: r, bank_change_cooldown_hours: c, driver_document_enforcement: mode })
  }

  const d = settings.data
  const unchanged = !!d && Number(grace) === d.licence_grace_days && Number(retention) === d.document_retention_days
    && Number(cooldown) === d.bank_change_cooldown_hours && mode === d.driver_document_enforcement

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="People and documents" description="How strict dispatch is about driver documents, and how long records are kept." />
      <CardBody>
        {settings.isLoading ? <Skeleton className="h-40 w-full" /> : settings.isError ? (
          <ErrorState compact title="We could not load these settings" onRetry={() => settings.refetch()} />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label="Licence grace days" type="number" inputMode="numeric" min="0" value={grace} onChange={e => setGrace(e.target.value)} error={errors.grace}
                hint="A licence counts as usable this many days after it expires, for example while a renewal is in progress." />
              <Input label="Keep documents after someone leaves (days)" type="number" inputMode="numeric" min="30" value={retention} onChange={e => setRetention(e.target.value)} error={errors.retention}
                hint="After this, their files are deleted. The record, dates and verification history stay." />
              <Input label="Bank change wait (hours)" type="number" inputMode="numeric" min="0" value={cooldown} onChange={e => setCooldown(e.target.value)} error={errors.cooldown}
                hint="A new or changed bank account is only used for payouts after this wait. Everyone concerned is told." />
            </div>
            <Select label="Driver document checks in dispatch" value={mode} onChange={e => setMode(e.target.value as EnforcementMode)} options={ENFORCEMENT_OPTIONS} className="sm:max-w-lg" hint={ENFORCEMENT_HELP[mode]} />
            <Button type="submit" loading={save.isPending} disabled={unchanged}>Save people settings</Button>
          </form>
        )}
      </CardBody>
    </Card>
  )
}
