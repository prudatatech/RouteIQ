import { Pause, Play, RotateCcw } from 'lucide-react'
import { Button, IconButton } from '@/components/ui'
import { Swatch } from '@/components/map/Swatch'
import { formatDateTime } from '@/utils/display'
import { PLAYBACK_SPEEDS, speedBucket, type ReplayPosition } from './replay'
import type { ReplayPlayer } from './useReplayPlayer'

/** Play, pause, scrub and speed for the trip replay, with the time and speed at the marker. */
export function ReplayPlayerBar({ player, startMs, endMs, position }: {
  player: ReplayPlayer
  startMs: number
  endMs: number
  position: ReplayPosition | null
}) {
  const span = Math.max(1, endMs - startMs)
  const progress = Math.round(((player.time - startMs) / span) * 1000)
  const bucket = speedBucket(position?.speedKmph)

  return (
    <div className="space-y-2 rounded-control border border-border bg-surface-subtle px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          label={player.playing ? 'Pause replay' : 'Play replay'}
          variant="primary"
          icon={player.playing ? <Pause size={16} /> : <Play size={16} />}
          onClick={player.toggle}
        />
        <IconButton label="Restart from the beginning" variant="secondary" icon={<RotateCcw size={16} />} onClick={player.restart} />
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={progress}
          onChange={e => player.seek(startMs + (Number(e.target.value) / 1000) * span)}
          aria-label="Position in the trip"
          aria-valuetext={formatDateTime(player.time)}
          className="h-2 min-w-32 flex-1 cursor-pointer accent-brand-fill"
        />
        <div role="group" aria-label="Playback speed" className="flex items-center gap-1">
          {PLAYBACK_SPEEDS.map(m => (
            <Button
              key={m}
              size="sm"
              variant={player.multiplier === m ? 'primary' : 'secondary'}
              aria-pressed={player.multiplier === m}
              onClick={() => player.setMultiplier(m)}
            >
              {m}x
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm" aria-live="off">
        <span className="font-medium tabular text-text">{formatDateTime(player.time)}</span>
        <span className="inline-flex items-center gap-2 text-muted">
          <Swatch color={bucket.color} shape="dot" />
          <span className="tabular text-text">{Math.round(position?.speedKmph ?? 0)} km/h</span>
        </span>
      </div>
      <p className="text-xs text-muted">1x plays one minute of the trip every second.</p>
    </div>
  )
}
