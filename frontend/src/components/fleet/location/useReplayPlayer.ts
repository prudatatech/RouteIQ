import { useCallback, useEffect, useRef, useState } from 'react'
import { advanceClock } from './replay'

/** The display is refreshed at most this often; the clock itself runs every animation frame. */
const MIN_RENDER_INTERVAL_MS = 33
/** A tab that was in the background comes back with a huge frame gap; cap it so the trip does not leap. */
const MAX_FRAME_MS = 250

export interface SkipRange { startMs: number; endMs: number }

export interface ReplayPlayer {
  /** Milliseconds since epoch, between the track's first and last fix. */
  time: number
  playing: boolean
  multiplier: number
  setMultiplier: (m: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (timeMs: number) => void
  restart: () => void
}

/**
 * The replay clock. It runs on requestAnimationFrame, so playback stays smooth however long the
 * track is, and only re-renders the page about 30 times a second. Any change of track resets it.
 * With `skip`, time spent standing still in one of the ranges is jumped over.
 */
export function useReplayPlayer(startMs: number, endMs: number, skip: SkipRange[] = []): ReplayPlayer {
  const [time, setTime] = useState(startMs)
  const [playing, setPlaying] = useState(false)
  const [multiplier, setMultiplier] = useState(5)

  const timeRef = useRef(startMs)
  const multiplierRef = useRef(multiplier)
  const skipRef = useRef(skip)
  multiplierRef.current = multiplier
  skipRef.current = skip

  const commit = useCallback((t: number) => {
    timeRef.current = t
    setTime(t)
  }, [])

  // A new track starts over, paused, at its first fix
  useEffect(() => {
    setPlaying(false)
    commit(startMs)
  }, [startMs, endMs, commit])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    let lastRender = last
    const tick = (now: number) => {
      const dt = Math.min(now - last, MAX_FRAME_MS)
      last = now
      const step = advanceClock(timeRef.current, dt, multiplierRef.current, endMs)
      let next = step.time
      const inside = skipRef.current.find(r => next >= r.startMs && next < r.endMs)
      if (inside) next = inside.endMs
      timeRef.current = next
      if (step.ended) {
        setPlaying(false)
        setTime(endMs)
        return
      }
      if (now - lastRender >= MIN_RENDER_INTERVAL_MS) {
        lastRender = now
        setTime(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, endMs])

  const play = useCallback(() => {
    // Pressing play at the end starts again
    if (timeRef.current >= endMs) commit(startMs)
    setPlaying(true)
  }, [endMs, startMs, commit])
  const pause = useCallback(() => setPlaying(false), [])
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play])
  const seek = useCallback((t: number) => commit(Math.min(Math.max(t, startMs), endMs)), [startMs, endMs, commit])
  const restart = useCallback(() => { commit(startMs); setPlaying(true) }, [startMs, commit])

  return { time, playing, multiplier, setMultiplier, play, pause, toggle, seek, restart }
}
