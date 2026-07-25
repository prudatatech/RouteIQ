
import React from 'react';
import { Brain, Zap, TrendingUp } from 'lucide-react';

interface AIInsightCardProps {
  title: string;
  insight: string;
  score: number;
  trend: 'up' | 'down';
}

export const AIInsightCard: React.FC<AIInsightCardProps> = ({ title, insight, score, trend }) => {
  return (
    <div className="relative group overflow-hidden rounded-2xl bg-white border border-slate-200 p-6 transition-all hover:border-yellow-400/50 hover:shadow-sm shadow-sm">
      {/* Background Glow Effect */}
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-yellow-400/10 blur-3xl group-hover:bg-yellow-400/20 transition-all"></div>
      
      <div className="flex items-start justify-between mb-4">
        <div className="p-3 rounded-xl bg-yellow-100 text-yellow-600 border border-yellow-200">
          <Brain className="w-6 h-6 animate-pulse" />
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-xs font-medium text-muted">
          <Zap className="w-3 h-3 text-yellow-500" />
          SYSTEM AI ACTIVE
        </div>
      </div>

      <h3 className="text-lg font-bold text-slate-900 mb-2 tracking-tight uppercase font-space group-hover:text-yellow-600 transition-colors">
        {title}
      </h3>
      
      <p className="text-muted text-sm leading-relaxed mb-6 font-medium">
        {insight}
      </p>

      <div className="flex items-end justify-between pt-4 border-t border-slate-200">
        <div>
          <span className="text-3xl font-black text-slate-900 font-space tracking-tighter">
            {score}%
          </span>
          <span className="text-muted text-[10px] uppercase font-bold tracking-widest block ml-1">
            Optimization Score
          </span>
        </div>
        
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-black ${
          trend === 'up' 
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
        }`}>
          <TrendingUp className={`w-4 h-4 ${trend === 'down' ? 'rotate-180' : ''}`} />
          {trend === 'up' ? '+12.4%' : '-2.1%'}
        </div>
      </div>

      {/* Futuristic Scanline Effect */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]"></div>
    </div>
  );
};
