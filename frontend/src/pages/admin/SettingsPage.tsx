import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, fleetAPI, vehiclesAPI } from '@/services/api'
import { Alert, Button, Card, CardBody, CardHeader, Input, Page, PageHeader, Select, Skeleton } from '@/components/ui'
import { ALERT_TYPE_LABELS, apiErrorMessage } from '@/components/fleet/health'

type Field = 'overspeed_kmph' | 'idle_minutes' | 'gps_lost_minutes' | 'low_fuel_pct'
interface AlertSettings {
  values: Record<Field, number>
  limits: Record<Field, { min: number; max: number }>
}

const FIELDS: { key: Field; label: string; unit: string; hint: string }[] = [
  { key: 'overspeed_kmph', label: 'Overspeed limit', unit: 'km/h', hint: 'An alert opens when a vehicle goes faster than this.' },
  { key: 'idle_minutes', label: 'Long idle', unit: 'minutes', hint: 'A vehicle on an active route that has not moved for this long.' },
  { key: 'gps_lost_minutes', label: 'GPS lost', unit: 'minutes', hint: 'A vehicle on an active route that has sent no location for this long.' },
  { key: 'low_fuel_pct', label: 'Low fuel', unit: '% in the tank', hint: 'Only for vehicles whose device reports a fuel level.' },
]

const TEST_EVENTS = ['overspeed', 'harsh_braking', 'harsh_acceleration', 'tamper', 'low_fuel', 'ignition', 'geofence']

interface VehicleOption { id: string; plate_number: string }

function AlarmRules() {
  const queryClient = useQueryClient()
  const settings = useQuery<AlertSettings>({ queryKey: ['fleet-alert-settings'], queryFn: () => fleetAPI.alertSettings() })
  const [draft, setDraft] = useState<Record<Field, string>>({ overspeed_kmph: '', idle_minutes: '', gps_lost_minutes: '', low_fuel_pct: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})

  useEffect(() => {
    if (settings.data) {
      setDraft(Object.fromEntries(FIELDS.map(f => [f.key, String(settings.data.values[f.key])])) as Record<Field, string>)
    }
  }, [settings.data])

  const save = useMutation({
    mutationFn: (body: Record<Field, number>) => fleetAPI.saveAlertSettings(body),
    onSuccess: () => {
      toast.success('Alarm rules saved')
      queryClient.invalidateQueries({ queryKey: ['fleet-alert-settings'] })
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not save the alarm rules. Try again.')),
  })

  const submit = () => {
    if (!settings.data) return
    const next: Partial<Record<Field, string>> = {}
    const body = {} as Record<Field, number>
    for (const f of FIELDS) {
      const n = Number(draft[f.key])
      const { min, max } = settings.data.limits[f.key]
      if (draft[f.key].trim() === '' || !Number.isFinite(n) || n < min || n > max) next[f.key] = `Enter a number from ${min} to ${max}.`
      else body[f.key] = n
    }
    setErrors(next)
    if (Object.keys(next).length === 0) save.mutate(body)
  }

  return (
    <Card>
      <CardHeader title="Alarm rules" description="The limits that open an alert when a vehicle reports its location." />
      <CardBody>
        {settings.isLoading ? <Skeleton className="h-40 w-full" /> : settings.isError ? (
          <Alert tone="danger" title="We could not load the alarm rules" action={<Button size="sm" variant="secondary" onClick={() => settings.refetch()}>Try again</Button>}>
            Check your connection and try again.
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map(f => (
                <Input
                  key={f.key}
                  label={f.label}
                  type="number"
                  inputMode="numeric"
                  value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  trailing={f.unit}
                  hint={f.hint}
                  error={errors[f.key]}
                />
              ))}
            </div>
            <div className="flex justify-end">
              <Button loading={save.isPending} onClick={submit}>Save alarm rules</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function TestAlarm() {
  const [vehicleId, setVehicleId] = useState('')
  const [event, setEvent] = useState('overspeed')
  const [result, setResult] = useState<'created' | 'repeat' | null>(null)
  const queryClient = useQueryClient()

  const vehicles = useQuery<VehicleOption[]>({
    queryKey: ['vehicles', 'settings-list'],
    queryFn: () => vehiclesAPI.list({ limit: 200 }) as Promise<VehicleOption[]>,
  })

  const send = useMutation({
    mutationFn: () => fleetAPI.sendTestAlarm(vehicleId, event),
    onSuccess: (res: { status: 'created' | 'repeat' }) => {
      setResult(res.status)
      queryClient.invalidateQueries({ queryKey: ['fleet-alerts'] })
    },
    onError: err => { setResult(null); toast.error(apiErrorMessage(err, 'We could not send the test alarm. Try again.')) },
  })

  return (
    <Card>
      <CardHeader
        title="Send test alarm"
        description="Sends an alarm through the same path as a real device event, to check that alerts and notifications reach staff. It is marked as a test and is not counted in reports or health scores."
      />
      <CardBody>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Vehicle"
              value={vehicleId}
              onChange={e => { setVehicleId(e.target.value); setResult(null) }}
              options={(vehicles.data ?? []).map(v => ({ value: v.id, label: v.plate_number }))}
              placeholder={vehicles.isLoading ? 'Loading vehicles' : 'Choose a vehicle'}
            />
            <Select
              label="Alarm type"
              value={event}
              onChange={e => { setEvent(e.target.value); setResult(null) }}
              options={TEST_EVENTS.map(t => ({ value: t, label: ALERT_TYPE_LABELS[t] }))}
            />
          </div>
          {result && (
            <Alert
              tone="success"
              title={result === 'created' ? 'Test alarm sent' : 'A test alarm of this type is already open'}
              action={<Link className="text-sm font-medium text-brand hover:underline" to="/fleet?tab=alerts">Open alerts</Link>}
            >
              {result === 'created'
                ? 'Check the alerts list and the notification bell. Resolve the test alarm when you are done.'
                : 'Resolve it in the alerts list to send another one.'}
            </Alert>
          )}
          <div className="flex justify-end">
            <Button disabled={!vehicleId} loading={send.isPending} onClick={() => send.mutate()}>Send test alarm</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

/** System settings for superadmins: alarm rules, and a way to check the alarm pipeline. */
export default function SettingsPage() {
  const webhookUrl = `${api.defaults.baseURL ?? ''}/telematics/webhook`
  return (
    <Page width="form">
      <PageHeader title="Settings" description="Alarm rules and the device webhook." />
      <AlarmRules />
      <Card>
        <CardHeader title="Device webhook" description="Give this address and the secret to your tracker provider. The secret is set on the server as FLEET_TELEMATICS_WEBHOOK_SECRET." />
        <CardBody>
          <p className="break-all rounded-control bg-surface-subtle px-3 py-2 font-mono text-sm text-text">{webhookUrl}</p>
          <p className="mt-2 text-sm text-muted">
            Send the secret as a Bearer token, or sign the request body with it and send the signature in the X-Signature header.
            Events: overspeed, harsh braking, harsh acceleration, tamper, low fuel, ignition and geofence.
          </p>
        </CardBody>
      </Card>
      <TestAlarm />
    </Page>
  )
}
