import React, { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'

export default function LiveRateMarquee() {
  const [rate, setRate] = useState<number | null>(null)

  useEffect(() => {
    // Fetch initial
    supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'rate_per_km')
      .single()
      .then(({ data }) => {
        if (data?.value?.rate) setRate(data.value.rate)
      })

    // Subscribe
    const channel = supabase
      .channel('system_settings_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_settings', filter: "key=eq.'rate_per_km'" },
        (payload) => {
          if (payload.new?.value?.rate) {
            setRate(payload.new.value.rate)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  if (!rate) return null

  return (
    <div className="w-full bg-primary/10 border-b border-primary/20 overflow-hidden py-2 relative flex items-center mb-6">
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        .animate-marquee {
          animation: marquee 15s linear infinite;
          white-space: nowrap;
        }
      `}</style>
      <div className="animate-marquee text-primary font-black uppercase tracking-[0.2em] text-xs">
        🚨 LIVE MARKET UPDATE: CURRENT RATE PER KM IS ₹{rate} 🚨
      </div>
    </div>
  )
}
