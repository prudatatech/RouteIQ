import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import { CheckCircle2, PackageCheck } from 'lucide-react'

export function GlobalDeliveryCelebration() {
  const [celebration, setCelebration] = useState<{ id: string, type: string, message: string } | null>(null)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>
    
    const triggerCelebration = (id: string, type: string, message: string) => {
      setCelebration({ id, type, message })
      
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        setCelebration(null)
      }, 5000) // Display celebration for 5 seconds
    }

    // Subscribe to both shipments and cargo_manifest tables for delivery status
    const channel = supabase.channel('global_delivery_events')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shipments' }, (payload) => {
        if (payload.new.status === 'delivered' && payload.old.status !== 'delivered') {
          triggerCelebration(
            payload.new.id, 
            'shipment', 
            `Shipment ${payload.new.tracking_id || ''} has been successfully delivered!`
          )
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cargo_manifest' }, (payload) => {
        if ((payload.new.status === 'fulfilled' || payload.new.status === 'delivered') && 
            (payload.old.status !== 'fulfilled' && payload.old.status !== 'delivered')) {
          triggerCelebration(
            payload.new.id, 
            'cargo', 
            `Cargo load has been successfully delivered by driver!`
          )
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      clearTimeout(timeout)
    }
  }, [])

  if (!celebration) return null

  // Generate 24 random confetti pieces
  const confetti = Array.from({ length: 24 }).map((_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.5}s`,
    duration: `${1 + Math.random()}s`,
    color: ['bg-emerald-400', 'bg-yellow-400', 'bg-blue-400', 'bg-purple-400'][Math.floor(Math.random() * 4)]
  }))

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center overflow-hidden">
      {/* Darkened blur background */}
      <div className="absolute inset-0 bg-emerald-900/20 backdrop-blur-sm animate-fade-in" />
      
      {/* Celebration Card */}
      <div className="relative animate-bounce-in flex flex-col items-center justify-center p-10 bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-[0_0_100px_rgba(16,185,129,0.4)] border border-emerald-500/20 text-center max-w-lg w-full mx-4 overflow-hidden">
        
        {/* Subtle radial glow behind the card */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.1)_0,transparent_100%)] rounded-[2.5rem]" />
        
        {/* Animated Icons */}
        <div className="relative mb-8 mt-4">
          <div className="w-36 h-36 rounded-full bg-emerald-50 flex items-center justify-center animate-pulse shadow-[inset_0_0_20px_rgba(16,185,129,0.1)]">
            <PackageCheck size={72} className="text-emerald-500 animate-scale-up drop-shadow-md" />
          </div>
          <div className="absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 shadow-xl">
            <div className="bg-emerald-100 rounded-full p-1">
              <CheckCircle2 size={36} className="text-emerald-500 animate-bounce" strokeWidth={3} />
            </div>
          </div>
        </div>

        <h2 className="text-4xl font-black text-emerald-900 uppercase tracking-tighter mb-3 drop-shadow-sm font-display">
          Cargo Delivered!
        </h2>
        
        <p className="text-slate-700 font-bold text-lg mb-2 px-4 leading-tight">
          {celebration.message}
        </p>
        
        <div className="mt-4 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-4 py-1.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-emerald-700 text-[10px] font-black uppercase tracking-[0.2em]">
            Driver confirmed drop-off
          </span>
        </div>

        {/* Confetti particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[2.5rem]">
          {confetti.map((c) => (
            <div 
              key={c.id} 
              className={`absolute w-3 h-3 ${c.color} rounded-sm animate-confetti opacity-80`}
              style={{ 
                left: c.left,
                top: '-5%',
                animationDelay: c.delay,
                animationDuration: c.duration
              }} 
            />
          ))}
        </div>
      </div>
    </div>
  )
}
