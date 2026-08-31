import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Activity, Globe2, ShieldCheck, ArrowRight, BrainCircuit, Network, Truck, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui'

export default function LandingPage() {
  const navigate = useNavigate()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text selection:bg-primary/30 relative overflow-hidden font-sans animate-fade-in">
      {/* Background Gradients & Effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-primary/20 blur-[150px] rounded-full pointer-events-none opacity-50" />
      <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none" />
      
      {/* Navigation */}
      <nav className="relative z-50 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3 group cursor-pointer">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/30 group-hover:rotate-12 transition-transform">
            <Zap size={22} className="text-bg fill-current" />
          </div>
          <span className="font-display font-black text-2xl uppercase tracking-tighter">Margix<span className="text-primary">India</span></span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/3pl/onboard')} className="text-sm font-bold uppercase tracking-widest text-muted hover:text-text transition-colors hidden sm:block">
            Become a Partner
          </button>
          <Button onClick={() => navigate('/login')} className="bg-surface hover:bg-surface2 text-text border border-border shadow-lg">
            Sign In
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 w-full max-w-7xl mx-auto px-6 pt-24 md:pt-32 pb-24 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-black uppercase tracking-widest mb-8 animate-fade-in-up">
          <Activity size={14} className="animate-pulse" />
          MargixIndia System 2.0 is Live
        </div>
        
        <h1 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-[0.9] max-w-4xl mb-8 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          Intelligent <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">Logistics</span> <br/>
          At Infinite Scale.
        </h1>
        
        <p className="text-lg md:text-xl text-muted font-medium max-w-2xl mb-12 opacity-0 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          The world’s first autonomous control tower powered by real-time telemetry, capacity cascade matching, and predictive AI.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <Button 
            onClick={() => navigate('/login')} 
            className="px-8 py-4 text-base font-black uppercase tracking-widest bg-primary hover:bg-primary-dark shadow-[0_0_40px_rgba(79,172,254,0.4)] transition-all flex items-center gap-3"
          >
            Access Control Tower <ArrowRight size={18} />
          </Button>
          <button 
            onClick={() => navigate('/3pl/onboard')} 
            className="px-8 py-4 text-base font-black uppercase tracking-widest text-text bg-surface border border-border hover:border-primary/50 hover:bg-surface2 rounded-xl transition-all shadow-xl flex items-center gap-3"
          >
            <Globe2 size={18} className="text-primary" /> Join 3PL Network
          </button>
        </div>

        {/* Dashboard Preview / Mockup */}
        <div className="mt-24 w-full max-w-5xl rounded-[2rem] border border-border bg-surface/50 backdrop-blur-3xl shadow-2xl p-4 opacity-0 animate-fade-in-up hidden md:block" style={{ animationDelay: '400ms' }}>
           <div className="w-full aspect-[21/9] rounded-[1.5rem] bg-bg overflow-hidden relative border border-border/50 flex text-left">
             {/* Sidebar */}
             <div className="w-16 h-full border-r border-border/50 bg-surface flex flex-col items-center py-6 gap-6">
               <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary"><Zap size={16} /></div>
               <div className="w-8 h-8 rounded-lg text-muted flex items-center justify-center"><Activity size={16} /></div>
               <div className="w-8 h-8 rounded-lg text-muted flex items-center justify-center"><Truck size={16} /></div>
               <div className="w-8 h-8 rounded-lg text-muted flex items-center justify-center"><BarChart3 size={16} /></div>
             </div>
             
             {/* Main Content */}
             <div className="flex-1 p-6 flex flex-col gap-6">
               {/* KPI Row */}
               <div className="grid grid-cols-4 gap-4 h-24">
                 {[
                   { label: 'Total Fleet', val: '148', sub: '+5% this week' },
                   { label: 'Active Routes', val: '92', sub: '7 pending' },
                   { label: 'Delivered Today', val: '312', sub: '98% on-time' },
                   { label: 'Avg. Utilization', val: '88.4%', sub: '+2.1% growth' }
                 ].map((k, i) => (
                   <div key={i} className="bg-surface rounded-xl border border-border/50 p-4 flex flex-col justify-between relative overflow-hidden">
                     <div className="text-xs font-bold text-muted uppercase tracking-wider">{k.label}</div>
                     <div className="text-2xl font-black text-text">{k.val}</div>
                     <div className="text-[10px] text-green-500 font-bold">{k.sub}</div>
                     {i === 3 && (
                       <svg className="absolute bottom-0 right-0 w-24 h-12 text-primary opacity-20" viewBox="0 0 100 50">
                         <path d="M0 50 Q 20 20 40 40 T 80 10 T 100 30 L 100 50 Z" fill="currentColor" />
                       </svg>
                     )}
                   </div>
                 ))}
               </div>

               {/* Map and Charts */}
               <div className="flex-1 grid grid-cols-3 gap-6">
                 {/* Live Map Area */}
                 <div className="col-span-2 bg-surface rounded-xl border border-border/50 relative overflow-hidden p-4 flex flex-col">
                   <div className="text-xs font-bold text-text uppercase tracking-widest mb-4 flex items-center justify-between">
                     <span>Live Truck Tracking Map</span>
                     <div className="flex gap-2">
                       <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                       <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                       <span className="w-2 h-2 rounded-full bg-red-500"></span>
                     </div>
                   </div>
                   <div className="flex-1 bg-surface2/30 rounded-lg border border-border/50 relative overflow-hidden flex items-center justify-center">
                     {/* Real Map Background */}
                     <img src="/map-bg.jpg" alt="Map Background" className="absolute inset-0 w-full h-full object-cover opacity-80 mix-blend-multiply" />
                     
                     {/* Subtle Map Overlay */}
                     <div className="absolute inset-0 bg-primary/5 mix-blend-overlay" />

                     {/* Routes Connecting Trucks */}
                     <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-50" viewBox="0 0 100 100" preserveAspectRatio="none">
                       <path d="M 20 30 L 40 60 L 70 40" stroke="currentColor" className="text-primary/50" strokeWidth="0.5" fill="none" strokeDasharray="1 1" />
                       <path d="M 50 20 L 70 40" stroke="currentColor" className="text-red-500/50" strokeWidth="0.5" fill="none" strokeDasharray="1 1" />
                       <path d="M 40 60 L 50 20" stroke="currentColor" className="text-green-500/50" strokeWidth="0.5" fill="none" strokeDasharray="1 1" />
                     </svg>
                     
                     {/* Truck Pins */}
                     <div className="absolute top-[30%] left-[20%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                       <div className="relative">
                         <div className="absolute inset-0 bg-primary/40 rounded-full animate-ping scale-150" />
                         <div className="bg-primary text-white p-1.5 rounded-full relative z-10 shadow-lg shadow-primary/40 border border-primary-dark">
                           <Truck size={12} />
                         </div>
                       </div>
                       <span className="mt-1 bg-bg border border-border px-1.5 py-0.5 rounded text-[8px] font-black text-text shadow-sm uppercase">TRK-104</span>
                     </div>
                     
                     <div className="absolute top-[60%] left-[40%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                       <div className="bg-green-500 text-white p-1.5 rounded-full relative z-10 shadow-lg shadow-green-500/40 border border-green-600">
                         <Truck size={12} />
                       </div>
                       <span className="mt-1 bg-bg border border-border px-1.5 py-0.5 rounded text-[8px] font-black text-text shadow-sm uppercase">TRK-066</span>
                     </div>

                     <div className="absolute top-[40%] left-[70%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                       <div className="bg-yellow-500 text-white p-1.5 rounded-full relative z-10 shadow-lg shadow-yellow-500/40 border border-yellow-600">
                         <Truck size={12} />
                       </div>
                       <span className="mt-1 bg-bg border border-border px-1.5 py-0.5 rounded text-[8px] font-black text-text shadow-sm uppercase">TRK-089</span>
                     </div>

                     <div className="absolute top-[20%] left-[50%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                       <div className="bg-red-500 text-white p-1.5 rounded-full relative z-10 shadow-lg shadow-red-500/40 border border-red-600">
                         <Truck size={12} />
                       </div>
                       <span className="mt-1 bg-bg border border-border px-1.5 py-0.5 rounded text-[8px] font-black text-text shadow-sm uppercase">TRK-121</span>
                     </div>
                   </div>
                 </div>

                 {/* Activity Feed */}
                 <div className="col-span-1 bg-surface rounded-xl border border-border/50 p-4 flex flex-col">
                   <div className="text-xs font-bold text-text uppercase tracking-widest mb-4">Real-Time Truck Status</div>
                   <div className="flex-1 space-y-3 overflow-hidden">
                     {[
                       { id: 'TRK-104', status: 'En Route', route: 'DEL → BOM', color: 'text-primary', bg: 'bg-primary/10' },
                       { id: 'TRK-089', status: 'Delayed', route: 'PUN → HYD', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
                       { id: 'TRK-121', status: 'Traffic', route: 'BOM → BLR', color: 'text-red-500', bg: 'bg-red-500/10' },
                       { id: 'TRK-066', status: 'Delivered', route: 'CHE → BLR', color: 'text-green-500', bg: 'bg-green-500/10' },
                     ].map((t, i) => (
                       <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-surface2 transition-colors border border-border/30">
                         <div className="flex items-center gap-3">
                           <div className={`w-8 h-8 rounded-md flex items-center justify-center ${t.bg} ${t.color}`}>
                             <Truck size={14} />
                           </div>
                           <div>
                             <div className="text-[10px] font-black uppercase text-text">{t.id}</div>
                             <div className="text-[9px] font-bold text-muted">{t.route}</div>
                           </div>
                         </div>
                         <div className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded ${t.bg} ${t.color}`}>
                           {t.status}
                         </div>
                       </div>
                     ))}
                   </div>
                 </div>
               </div>
             </div>
           </div>
        </div>
      </main>

      {/* Features Section */}
      <section className="relative z-10 w-full bg-surface/50 border-y border-border py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-5xl font-black uppercase tracking-tighter mb-4">The Operating System for Freight</h2>
            <p className="text-muted text-lg max-w-2xl mx-auto">Built for enterprise scale, MargixIndia eliminates manual dispatching, connects fragmented supply chains, and optimizes every route in real-time.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: BrainCircuit, title: 'AI Matching Engine', desc: 'Auto-assigns loads using Haversine distance, driver SLAs, and dynamic capacity scoring.' },
              { icon: Network, title: 'Tiered Cascade', desc: 'Seamlessly routes unfulfilled orders from internal fleets to vetted 3PL partners in milliseconds.' },
              { icon: Activity, title: 'Real-Time Telemetry', desc: 'Live GPS tracking, geo-fencing, and vehicle health monitoring powered by IoT integration.' },
              { icon: ShieldCheck, title: 'Automated Compliance', desc: 'Self-serve partner onboarding with automated GSTIN verification and smart contract agreements.' },
            ].map((f, i) => (
              <div key={i} className="bg-bg border border-border p-8 rounded-[2rem] hover:border-primary/50 transition-colors group">
                <div className="w-14 h-14 bg-surface2 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary/20 transition-all">
                  <f.icon size={28} className="text-primary" />
                </div>
                <h3 className="text-lg font-black uppercase tracking-widest mb-3">{f.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between text-center md:text-left gap-6 border-t border-border mt-12">
        <div className="flex items-center justify-center md:justify-start gap-2">
          <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
            <Zap size={12} className="text-bg fill-current" />
          </div>
          <span className="font-display font-black text-sm uppercase tracking-widest">MargixIndia</span>
        </div>
        <div className="text-xs font-bold text-muted uppercase tracking-widest">
          © {new Date().getFullYear()} Safexpress MargixIndia. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
