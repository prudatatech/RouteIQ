import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, MapPin } from 'lucide-react'
import { supabase, openChannel } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Modal } from '@/components/ui'
import { telemetryAPI } from '@/services/api'
import { apiErrorMessage } from '@/components/fleet/health'
import { sosSeverityLabel, sosStatusOf, sosTypeLabel } from '@/utils/sos'
import { formatTime } from '@/utils/display'
import { OPEN_EXCEPTION_FILTER, cargoKeys, exceptionsAPI } from '@/services/cargo'
import { OnBoardList } from '@/components/cargo/OnBoardList'
import { onBoardTotals, useOnBoard } from '@/components/cargo/useOnBoard'
import { holdCaseFor } from '@/components/cargo/logic'

interface SosAlert {
  id: string
  vehicle_id: string | null
  alert_type: string | null
  description: string | null
  latitude: number | null
  longitude: number | null
  severity?: string | null
  created_at: string
  plate?: string | null
}

const DEFAULT_DESCRIPTIONS = new Set(['Driver triggered SOS from mobile app', 'Driver triggered SOS emergency alert'])

/**
 * Repeating two-tone alarm made with the Web Audio API, so it needs no audio file.
 * Browsers only allow sound after the user has interacted with the page.
 */
function createAlarm() {
  let ctx: AudioContext | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  const beep = () => {
    if (!ctx) return
    const now = ctx.currentTime
    ;[880, 660].forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.2, now + i * 0.25)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.25 + 0.22)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(now + i * 0.25)
      osc.stop(now + i * 0.25 + 0.24)
    })
  }
  return {
    start() {
      if (timer) return
      try {
        ctx = new AudioContext()
        beep()
        timer = setInterval(beep, 1000)
      } catch (err) {
        console.warn('Alarm sound unavailable', err)
      }
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      ctx?.close().catch(() => undefined)
      ctx = null
    },
  }
}

const CARGO_ROWS = 4

/** What the SOS vehicle carries, and the case opened for it. `onCase` receives the case id so the modal can offer "Plan the cargo". */
function SosCargo({ alert, onCase }: { alert: SosAlert; onCase: (id: string | null) => void }) {
  const onBoard = useOnBoard(alert.vehicle_id)
  const items = onBoard.data?.items ?? []
  const filters = { vehicle_id: alert.vehicle_id ?? '', status: OPEN_EXCEPTION_FILTER }
  const cases = useQuery({
    queryKey: cargoKeys.exceptions(filters),
    queryFn: () => exceptionsAPI.list(filters),
    enabled: !!alert.vehicle_id && items.length > 0,
    refetchInterval: 15_000,
  })
  // The backend keeps one hold case per vehicle; a serious SOS opens it or joins the one already open
  const caseId = holdCaseFor(cases.data ?? [], { sosAlertId: alert.id })?.id ?? null
  useEffect(() => { onCase(caseId) }, [caseId, onCase])

  if (!alert.vehicle_id || onBoard.isLoading || onBoard.isError || items.length === 0) return null
  const totals = onBoardTotals(items)
  return (
    <div className="space-y-1 border-t border-border pt-3">
      <p className="font-medium text-text">
        On board: {totals.consignments.toLocaleString('en-IN')} {totals.consignments === 1 ? 'consignment' : 'consignments'}, {totals.pieces.toLocaleString('en-IN')} pieces
      </p>
      <OnBoardList items={items.slice(0, CARGO_ROWS)} compact />
      {items.length > CARGO_ROWS && <p className="text-xs text-muted">+{(items.length - CARGO_ROWS).toLocaleString('en-IN')} more</p>}
    </div>
  )
}

/** Raises new driver SOS alerts to staff anywhere in the console, with an alarm. */
export default function SOSListener() {
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [alerts, setAlerts] = useState<SosAlert[]>([])
  const [acknowledging, setAcknowledging] = useState(false)
  const [caseId, setCaseId] = useState<string | null>(null)
  const alarm = useRef(createAlarm())
  const alertsRef = useRef(alerts)
  alertsRef.current = alerts

  useEffect(() => {
    if (role !== 'superadmin' && role !== 'admin' && role !== 'manager') return
    const siren = alarm.current
    const channel = openChannel('sos_alerts_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts' }, async payload => {
        const alert = payload.new as SosAlert
        if (alert.vehicle_id) {
          const { data } = await supabase.from('vehicles').select('plate_number').eq('id', alert.vehicle_id).maybeSingle()
          alert.plate = data?.plate_number ?? null
        }
        setAlerts(list => (list.some(a => a.id === alert.id) ? list : [...list, alert]))
        siren.start()
      })
      // Someone dealt with the alert (another dispatcher acknowledged or resolved it, or the driver
      // cancelled it in the app): stop asking, and stop the siren when nothing is left.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts' }, payload => {
        const next = payload.new as { id: string; status: string | null }
        if (sosStatusOf(next.status) === 'active') return
        const gone = alertsRef.current.find(a => a.id === next.id)
        if (gone && next.status === 'cancelled') {
          toast.success(`${gone.plate ? `The driver of ${gone.plate}` : 'The driver'} cancelled the SOS`)
        }
        setAlerts(list => list.filter(a => a.id !== next.id))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      siren.stop()
    }
  }, [role])

  const current = alerts[0]
  useEffect(() => { if (!current) alarm.current.stop() }, [current])

  if (!current) return null

  const dismiss = () => setAlerts(list => list.slice(1))
  // Taking it on stops the siren and closes the popup for everyone else too (the update reaches their listener).
  const acknowledge = async () => {
    setAcknowledging(true)
    try {
      await telemetryAPI.acknowledgeSos(current.id)
      queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
      toast.success('SOS acknowledged')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'We could not acknowledge this SOS. Open Emergencies to check it.'))
    } finally {
      setAcknowledging(false)
    }
    dismiss()
  }
  const open = () => {
    setAlerts([])
    navigate(`/emergency?open=${current.id}`)
  }
  const planCargo = () => {
    if (!caseId) return
    setAlerts([])
    navigate(`/cargo/exceptions/${caseId}?action=transship`)
  }
  const title = !current.alert_type || current.alert_type === 'panic_button' ? 'SOS from a driver' : sosTypeLabel(current.alert_type)
  const note = current.description && !DEFAULT_DESCRIPTIONS.has(current.description) ? current.description : null

  return (
    <Modal
      open
      onClose={dismiss}
      closeOnBackdrop={false}
      size="sm"
      title={<span className="inline-flex items-center gap-2 text-danger"><AlertTriangle size={20} aria-hidden="true" /> {title}</span>}
      description={`${current.plate ? `Vehicle ${current.plate}` : 'A driver'} · ${formatTime(current.created_at)}`}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="secondary" disabled={acknowledging} onClick={dismiss}>{alerts.length > 1 ? `Dismiss (${alerts.length - 1} more)` : 'Dismiss'}</Button>
          <Button variant="secondary" loading={acknowledging} onClick={acknowledge}>Acknowledge</Button>
          {caseId && <Button variant="secondary" disabled={acknowledging} onClick={planCargo}>Plan the cargo</Button>}
          <Button variant="danger" disabled={acknowledging} onClick={open}>Open emergencies</Button>
        </div>
      }
    >
      <div role="alert" className="space-y-3 text-sm">
        {sosSeverityLabel(current.severity) && (
          <p className={'font-medium ' + (current.severity === 'serious' ? 'text-danger' : 'text-muted')}>{sosSeverityLabel(current.severity)}</p>
        )}
        {note && <p className="text-text">“{note}”</p>}
        {current.latitude != null && current.longitude != null ? (
          <p className="flex items-center gap-2 text-muted">
            <MapPin size={16} aria-hidden="true" />
            <span className="mono">{current.latitude.toFixed(5)}, {current.longitude.toFixed(5)}</span>
          </p>
        ) : (
          <p className="text-muted">No location was sent with this alert.</p>
        )}
        <SosCargo key={current.id} alert={current} onCase={setCaseId} />
      </div>
    </Modal>
  )
}
