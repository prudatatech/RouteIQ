import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Star } from 'lucide-react'
import { Button, Textarea } from '@/components/ui'
import { shipmentsAPI } from '@/services/api'
import { apiErrorMessage } from './format'

const LABELS = ['Poor', 'Below average', 'Good', 'Very good', 'Excellent']

/** Staff rate the driver from 1 to 5 stars after a delivery. The rating can be changed later. */
export default function DriverRating({ shipmentId, rating, note }: {
  shipmentId: string
  rating?: number | null
  note?: string | null
}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState<number>(rating ?? 0)
  const [text, setText] = useState(note ?? '')

  useEffect(() => {
    setValue(rating ?? 0)
    setText(note ?? '')
  }, [shipmentId, rating, note])

  const save = useMutation({
    mutationFn: () => shipmentsAPI.rateDriver(shipmentId, value, text.trim() || null),
    onSuccess: () => {
      toast.success('Rating saved')
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'driver-performance'] })
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not save the rating. Try again.')),
  })

  const unchanged = value === (rating ?? 0) && text.trim() === (note ?? '')

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Driver rating" className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of 5, ${LABELS[n - 1]}`}
            onClick={() => setValue(n)}
            className="rounded-control p-1 text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Star size={24} aria-hidden="true" fill={n <= value ? 'currentColor' : 'none'} />
          </button>
        ))}
        <span className="ml-2 text-sm text-muted">{value > 0 ? LABELS[value - 1] : 'Not rated yet'}</span>
      </div>
      <Textarea label="Note (optional)" rows={2} maxLength={500} value={text} onChange={e => setText(e.target.value)} />
      <Button size="sm" disabled={value === 0 || unchanged} loading={save.isPending} onClick={() => save.mutate()}>
        {rating ? 'Update rating' : 'Save rating'}
      </Button>
    </div>
  )
}
