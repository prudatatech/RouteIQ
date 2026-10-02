import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { RotateCcw } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import { Button, Card, Skeleton } from '@/components/ui'
import { saveGuestDraft } from '@/utils/guestDraft'
import { errorMessage, formatDate, formatKg } from '@/utils/display'
import type { LoadSummary } from '@/types/load'
import { repostToDraft } from './draft'

const statusText = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/** Loads posted with the Post a Load form, by load number, each with a Repost button. Shows nothing when there are none. */
export default function PostedLoads({ enabled = true }: { enabled?: boolean }) {
  const navigate = useNavigate()
  const list = useQuery({
    queryKey: ['vendor', 'posted-loads'],
    queryFn: () => vendorAPI.myPostedLoads(),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  })

  const repost = useMutation({
    mutationFn: (id: string) => vendorAPI.repostLoad(id).then(payload => ({ id, payload })),
    onSuccess: ({ id, payload }) => {
      // The form opens with everything filled in except the dates, on the first step where the pickup date is chosen.
      saveGuestDraft('load', { ...repostToDraft(payload, id), step: 0 })
      navigate('/vendor/request')
    },
    onError: err => toast.error(errorMessage(err, 'We could not copy this load. Try again.')),
  })

  if (list.isLoading) return <Skeleton className="h-24 w-full" />
  const items: LoadSummary[] = list.data?.items ?? []
  if (list.isError || items.length === 0) return null

  return (
    <section aria-labelledby="posted-loads-title" className="space-y-3">
      <h2 id="posted-loads-title" className="text-lg font-semibold text-text">
        Posted loads <span className="ml-1 text-sm font-normal text-muted tabular">{items.length}</span>
      </h2>
      <div className="space-y-3">
        {items.map(l => (
          <Card key={l.id} padded className="flex flex-col gap-3 !p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link to={`/vendor/loads/${encodeURIComponent(l.id)}`} className="font-mono text-sm font-medium text-brand hover:underline">{l.load_number}</Link>
                <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs font-medium text-text">{statusText(l.status)}</span>
              </div>
              <p className="text-sm font-medium text-text">{l.pickup_city ?? '—'} → {l.delivery_city ?? '—'}</p>
              <p className="text-sm text-muted">
                {l.pickup_date ? `Pickup ${formatDate(l.pickup_date)}` : 'No pickup date'}
                {l.total_weight_kg ? ` · ${formatKg(l.total_weight_kg)}` : ''}
              </p>
            </div>
            <Button
              variant="secondary" size="sm" icon={<RotateCcw size={14} />}
              loading={repost.isPending && repost.variables === l.id}
              onClick={() => repost.mutate(l.id)}
            >
              Repost
            </Button>
          </Card>
        ))}
      </div>
    </section>
  )
}
