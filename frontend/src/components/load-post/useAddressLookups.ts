import { useEffect, useState } from 'react'
import { publicAPI } from '@/services/api'
import type { LoadDraft } from '@/types/load'

export type Side = 'pickup' | 'delivery'

/** Looks the state up when a 6-digit pin code is entered, and clears it when the pin code changes. */
export function usePinState(side: Side, pin: string, stateCode: string, onChange: (patch: Partial<LoadDraft>) => void) {
  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) {
      if (stateCode) onChange({ [`${side}_state_code`]: '', [`${side}_state_name`]: '' } as Partial<LoadDraft>)
      return
    }
    let live = true
    publicAPI.pincode(pin)
      .then(info => {
        if (!live) return
        onChange({ [`${side}_state_code`]: info?.state_code ?? '', [`${side}_state_name`]: info?.state_name ?? '' } as Partial<LoadDraft>)
      })
      .catch(() => { /* the form still works; the server finds the state on submit */ })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])
}

/** City names from GET /public/cities for what has been typed (after a short pause). The city stays free text. */
export function useCitySuggestions(typed: string): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    const q = typed.trim()
    if (q.length < 2) { setNames([]); return }
    let live = true
    const t = setTimeout(() => {
      publicAPI.cities(q).then(list => { if (live) setNames(list) }).catch(() => { if (live) setNames([]) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [typed])
  return names
}
