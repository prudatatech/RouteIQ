import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, MapPin } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button, Modal } from '@/components/ui'
import { sosTypeLabel } from '@/utils/sos'

interface SosAlert {
  id: string
  vehicle_id: string | null
  alert_type: string | null
  description: string | null
  latitude: number | null
  longitude: number | null
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

/** Raises new driver SOS alerts to staff anywhere in the console, with an alarm. */
export default function SOSListener() {
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState<SosAlert[]>([])
  const alarm = useRef(createAlarm())

  useEffect(() => {
    if (role !== 'superadmin' && role !== 'admin') return
    const siren = alarm.current
    const channel = supabase
      .channel('sos_alerts_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts' }, async payload => {
        const alert = payload.new as SosAlert
        if (alert.vehicle_id) {
          const { data } = await supabase.from('vehicles').select('plate_number').eq('id', alert.vehicle_id).maybeSingle()
          alert.plate = data?.plate_number ?? null
        }
        setAlerts(list => (list.some(a => a.id === alert.id) ? list : [...list, alert]))
        siren.start()
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
  const open = () => {
    setAlerts([])
    navigate('/emergency')
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
      description={`${current.plate ? `Vehicle ${current.plate}` : 'A driver'} · ${new Date(current.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
      footer={
        <>
          <Button variant="secondary" onClick={dismiss}>{alerts.length > 1 ? `Dismiss (${alerts.length - 1} more)` : 'Dismiss'}</Button>
          <Button variant="danger" onClick={open}>Open emergencies</Button>
        </>
      }
    >
      <div role="alert" className="space-y-3 text-sm">
        {note && <p className="text-text">“{note}”</p>}
        {current.latitude != null && current.longitude != null ? (
          <p className="flex items-center gap-2 text-muted">
            <MapPin size={16} aria-hidden="true" />
            <span className="mono">{current.latitude.toFixed(5)}, {current.longitude.toFixed(5)}</span>
          </p>
        ) : (
          <p className="text-muted">No location was sent with this alert.</p>
        )}
      </div>
    </Modal>
  )
}
