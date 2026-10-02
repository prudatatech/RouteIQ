import { useEffect, useRef, useState } from 'react'
import { publicAPI } from '@/services/api'
import type { AssistResult, LoadDraft } from '@/types/load'
import { toPayload } from './logic'

export const ASSIST_DEBOUNCE_MS = 400

/**
 * The server's totals, tax, suggestions and estimate for the form as it is now. Asked 400 ms after
 * the last change. A form that is still half empty may be refused; the last good answer stays.
 */
export function useLoadAssist(draft: LoadDraft, enabled = true): { assist: AssistResult | null; loading: boolean } {
  const [assist, setAssist] = useState<AssistResult | null>(null)
  const [loading, setLoading] = useState(false)
  const latest = useRef(draft)
  latest.current = draft

  const worthAsking = draft.items.some(i => i.hsn_code || i.weight_kg || i.declared_value) || !!(draft.pickup_city && draft.delivery_city)
  // The step and the pin code's state name are not part of the question.
  const key = JSON.stringify(toPayload(draft))

  useEffect(() => {
    if (!enabled || !worthAsking) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      publicAPI.loadAssist(toPayload(latest.current), ctrl.signal)
        .then(result => { if (!ctrl.signal.aborted) setAssist(result) })
        .catch(err => { if (!ctrl.signal.aborted) console.warn('Load assist unavailable', err) })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    }, ASSIST_DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [key, enabled, worthAsking])

  return { assist, loading }
}
