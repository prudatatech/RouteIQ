import { useCallback, useState } from 'react'
import { BASE_STYLE_IDS, type BaseStyleId } from '@/config/mapConfig'

/** What the layer switcher on the live map remembers between visits. */
export interface LayerPrefs {
  base: BaseStyleId
  /** Live traffic flow colours on the roads. */
  flow: boolean
  /** Traffic incident icons (accidents, road works, closures). */
  traffic: boolean
  routes: boolean
  trails: boolean
  clusters: boolean
}

export const DEFAULT_LAYER_PREFS: LayerPrefs = { base: 'streets', flow: true, traffic: true, routes: true, trails: true, clusters: true }

const STORAGE_KEY = 'margixindia.liveMap.layers'

/** Reads saved preferences, ignoring anything unreadable or unknown. Pure so it can be tested. */
export function parseLayerPrefs(raw: string | null): LayerPrefs {
  if (!raw) return DEFAULT_LAYER_PREFS
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof LayerPrefs, unknown>>
    const flag = (key: 'flow' | 'traffic' | 'routes' | 'trails' | 'clusters') =>
      typeof value[key] === 'boolean' ? (value[key] as boolean) : DEFAULT_LAYER_PREFS[key]
    return {
      base: BASE_STYLE_IDS.includes(value.base as BaseStyleId) ? (value.base as BaseStyleId) : DEFAULT_LAYER_PREFS.base,
      flow: flag('flow'),
      traffic: flag('traffic'),
      routes: flag('routes'),
      trails: flag('trails'),
      clusters: flag('clusters'),
    }
  } catch {
    return DEFAULT_LAYER_PREFS
  }
}

function load(): LayerPrefs {
  try {
    return parseLayerPrefs(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_LAYER_PREFS
  }
}

/** Layer choices for a map, kept in this browser only (a convenience, so the page works without it). */
export function useLayerPrefs(): [LayerPrefs, (patch: Partial<LayerPrefs>) => void] {
  const [prefs, setPrefs] = useState<LayerPrefs>(load)
  const update = useCallback((patch: Partial<LayerPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Storage blocked: the choice still applies for this visit.
      }
      return next
    })
  }, [])
  return [prefs, update]
}
