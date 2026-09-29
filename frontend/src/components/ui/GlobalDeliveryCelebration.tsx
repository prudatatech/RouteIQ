import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase, openChannel } from '@/services/supabase'

/**
 * Announces deliveries confirmed by drivers while staff are in the console. A short
 * notice rather than a full-screen overlay, so it never interrupts the work on screen.
 */
export function GlobalDeliveryCelebration() {
  useEffect(() => {
    const channel = openChannel('global_delivery_events')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shipments' }, payload => {
        if (payload.new.status === 'delivered' && payload.old.status !== 'delivered') {
          const ref = payload.new.tracking_id ? ` ${payload.new.tracking_id}` : ''
          toast.success(`Shipment${ref} delivered. The driver confirmed drop-off.`, { id: `delivered-${payload.new.id}`, duration: 6000 })
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cargo_manifest' }, payload => {
        const done = (s: unknown) => s === 'fulfilled' || s === 'delivered'
        if (done(payload.new.status) && !done(payload.old.status)) {
          toast.success('Cargo load delivered. The driver confirmed drop-off.', { id: `cargo-delivered-${payload.new.id}`, duration: 6000 })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return null
}
