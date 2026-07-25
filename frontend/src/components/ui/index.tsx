import { ReactNode } from 'react'
import clsx from 'clsx'

// ---------- Card ----------
export function Card({ children, className, glass = true }: { children: ReactNode; className?: string, glass?: boolean }) {
  return (
    <div className={clsx(glass ? 'glass-card' : 'bg-surface', 'rounded-[24px] overflow-hidden', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: ReactNode
}) {
  return (
    <div className="px-5 pt-5 pb-4 flex items-start justify-between">
      <div>
        <div className="font-heading font-semibold text-base text-slate-900">{title}</div>
        {subtitle && <div className="text-xs text-muted mt-1">{subtitle}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

// ---------- Badge ----------
type BadgeVariant = 'green' | 'orange' | 'blue' | 'warn' | 'muted'

const badgeStyles: Record<BadgeVariant, string> = {
  green:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  blue:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  warn:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  muted:  'bg-slate-800/50 text-muted border-border/50',
}

export function Badge({ children, variant = 'green', className }: { children: ReactNode; variant?: BadgeVariant; className?: string }) {
  return (
    <span className={clsx(
      'text-[10px] font-black uppercase tracking-[0.15em] px-3 py-1 rounded-lg border mono transition-all',
      badgeStyles[variant],
      className
    )}>
      {children}
    </span>
  )
}

// ---------- Status Dot ----------
const dotColors: Record<string, string> = {
  on_route: 'bg-[#F9C935] shadow-[0_0_8px_rgba(249,201,53,0.5)]',
  available: 'bg-[#3B82F6] shadow-[0_0_8px_rgba(59,130,246,0.5)]',
  idle: 'bg-[#64748B]',
  maintenance: 'bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.5)]',
  offline: 'bg-[#FF4D4D] shadow-[0_0_8px_rgba(255,77,77,0.5)]',
}

export function StatusDot({ status }: { status: string }) {
  const colorClass = dotColors[status] || 'bg-slate-500'
  return (
    <span className={clsx('inline-block w-2 h-2 rounded-full flex-shrink-0 animate-pulse-soft', colorClass)} />
  )
}

// ---------- Button ----------
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'ghost' | 'accent' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({
  children, variant = 'ghost', size = 'md', className, ...props
}: ButtonProps) {
  const variants = {
    ghost:  'bg-slate-50 border border-slate-200 text-muted hover:bg-slate-100 hover:text-slate-900',
    accent: 'bg-yellow-400 text-black font-black hover:bg-yellow-300 shadow-[0_8px_24px_rgba(249,201,53,0.3)] hover:scale-[1.02]',
    danger: 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20',
  }
  const sizes = {
    sm: 'px-4 py-2 text-xs font-bold',
    md: 'px-6 py-3 text-sm font-black uppercase tracking-tight',
  }
  
  return (
    <button 
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )} 
      {...props}
    >
      {children}
    </button>
  )
}

// ---------- KPI Card ----------
export function KPICard({ label, value, delta, deltaUp, icon, color, progress }: {
  label: string; value: string; delta?: string; deltaUp?: boolean
  icon: ReactNode; color: string; progress?: number
}) {
  return (
    <div className="glass-card p-6 animate-fade-up border-slate-200">
      <div className="flex justify-between items-start mb-6">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
          {icon}
        </div>
        {delta && (
          <span className={clsx(
            "text-[10px] mono font-black px-2.5 py-1 rounded-full",
            deltaUp ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"
          )}>
            {deltaUp ? '↑' : '↓'} {delta}
          </span>
        )}
      </div>
      <div className="font-display text-4xl font-black tracking-tighter text-slate-900 mb-2 leading-none">{value}</div>
      <div className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">{label}</div>
      
      {progress !== undefined && (
        <div className="mt-6 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-1000 ease-out" 
            style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${color}, ${color}CC)` }} 
          />
        </div>
      )}
    </div>
  )
}

// ---------- Loading Spinner ----------
export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <div 
      className="border-2 border-border border-t-yellow-400 rounded-full animate-spin"
      style={{ width: size, height: size }} 
    />
  )
}
