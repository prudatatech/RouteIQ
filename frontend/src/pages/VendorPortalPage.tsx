import { useEffect, useState } from 'react'
import { MapPin, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useNavigate, useOutletContext } from 'react-router-dom'
import LiveRateMarquee from '@/components/LiveRateMarquee'

export default function VendorPortalPage() {
  const [heroSearchTerm, setHeroSearchTerm] = useState('')
  const [heroSuggestions, setHeroSuggestions] = useState<any[]>([])

  const navigate = useNavigate()
  const { vendorProfile } = useOutletContext<any>() || {}

  useEffect(() => {
    const searchHeroMapbox = async () => {
      if (!heroSearchTerm || heroSearchTerm.length < 3) {
        setHeroSuggestions([])
        return
      }
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(heroSearchTerm)}.json?country=in&types=place,locality,address&limit=5&access_token=${token}`)
        const data = await res.json()
        setHeroSuggestions(data.features || [])
      } catch (e) {
        console.error(e)
      }
    }
    const delay = setTimeout(searchHeroMapbox, 400)
    return () => clearTimeout(delay)
  }, [heroSearchTerm])

  return (
    <div className="w-full animate-fade-in relative z-10 pb-32">
      <LiveRateMarquee />
      
      {/* Amazon-style Universal Search Hero */}
      <section className="px-6 lg:px-12 flex flex-col items-center justify-center text-center py-12 lg:py-20 animate-fade-in relative">
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />
         <h2 className="text-4xl lg:text-6xl font-display font-black tracking-tight mb-6">
           Where are you shipping <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">today?</span>
         </h2>
         <p className="text-muted text-lg max-w-2xl mb-10">
           Instantly access verified fleet capacity, post your loads with floor prices, and track everything in real-time.
         </p>
         
         <div className="w-full max-w-3xl relative flex flex-col items-center z-30">
           <div className="w-full relative flex items-center glass-card rounded-full p-2 border-primary/30 shadow-[0_0_40px_rgba(79,172,254,0.15)] focus-within:border-primary focus-within:shadow-[0_0_50px_rgba(79,172,254,0.3)] transition-all bg-surface/50 backdrop-blur-xl">
             <MapPin className="text-primary ml-4" size={24} />
             <input 
               type="text"
               value={heroSearchTerm}
               onChange={e => setHeroSearchTerm(e.target.value)}
               placeholder="Where is your shipment located?"
               className="w-full bg-transparent border-none text-text px-4 py-4 focus:outline-none focus:ring-0 text-lg font-bold placeholder:text-muted/50"
             />
             <button 
               onClick={() => {
                 if (!heroSearchTerm.trim()) {
                   toast.error('Please enter a location first');
                   return;
                 }
                 navigate(`/vendor/request?query=${encodeURIComponent(heroSearchTerm)}`);
               }} 
               className="bg-primary hover:bg-primary-dark text-white px-8 py-4 rounded-full font-black uppercase tracking-widest text-sm flex items-center gap-2 shadow-lg transition-transform active:scale-95 shrink-0"
             >
               Post Load <ArrowRight size={18} />
             </button>
           </div>
           
           {heroSuggestions.length > 0 && (
             <div className="absolute top-[110%] left-0 w-full bg-surface2 border border-border rounded-3xl shadow-2xl overflow-hidden z-40 animate-fade-in">
               {heroSuggestions.map((s: any) => (
                 <button
                   key={s.id}
                   onClick={() => {
                      navigate(`/vendor/request?query=${encodeURIComponent(s.place_name)}&lat=${s.center[1]}&lng=${s.center[0]}`)
                    }}
                   className="w-full text-left px-6 py-4 border-b border-border hover:bg-surface transition-colors flex items-center gap-4 group"
                 >
                   <MapPin size={20} className="text-muted group-hover:text-primary transition-colors shrink-0" />
                   <span className="text-text font-bold text-sm truncate">{s.place_name}</span>
                 </button>
               ))}
             </div>
           )}
         </div>
      </section>

      {/* Overview Cards */}
      <section className="px-6 lg:px-12 grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto mt-8">
        <div 
          onClick={() => navigate('/vendor/corridor')}
          className="bg-surface border border-border rounded-3xl p-8 hover:border-primary/50 hover:shadow-[0_20px_40px_rgba(0,0,0,0.5)] transition-all cursor-pointer group flex flex-col items-center text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
             <MapPin className="text-primary" size={32} />
          </div>
          <h3 className="text-2xl font-bold mb-2 group-hover:text-primary transition-colors">Live Corridors</h3>
          <p className="text-muted text-sm max-w-[200px] mb-6">View passing trucks and active bid markets in real-time.</p>
          <div className="mt-auto text-primary font-bold uppercase tracking-widest text-xs flex items-center gap-2">
             Explore <ArrowRight size={14} className="group-hover:translate-x-2 transition-transform" />
          </div>
        </div>

        <div 
          onClick={() => navigate('/vendor/shipments')}
          className="bg-surface border border-border rounded-3xl p-8 hover:border-primary/50 hover:shadow-[0_20px_40px_rgba(0,0,0,0.5)] transition-all cursor-pointer group flex flex-col items-center text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mb-6">
             <ArrowRight className="text-accent" size={32} />
          </div>
          <h3 className="text-2xl font-bold mb-2 group-hover:text-accent transition-colors">My Shipments</h3>
          <p className="text-muted text-sm max-w-[200px] mb-6">Track your active bids, placed requests, and history.</p>
          <div className="mt-auto text-accent font-bold uppercase tracking-widest text-xs flex items-center gap-2">
             Manage <ArrowRight size={14} className="group-hover:translate-x-2 transition-transform" />
          </div>
        </div>
      </section>
    </div>
  )
}
