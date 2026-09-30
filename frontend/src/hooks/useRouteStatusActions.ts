import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { AxiosError } from 'axios'
import { routesAPI } from '@/services/api'
import { useConfirm } from '@/components/ui'

interface RouteStatusLike {
  id: string
  status: string
  is_manifest?: boolean
  route_stops?: readonly object[] | null
}

/** Cargo-manifest routes are shown as routes but live in another table; PATCH /routes/:id/status can't change them. */
export const canDispatchRoute = (r: RouteStatusLike) => !r.is_manifest && r.status === 'pending'
export const canCompleteRoute = (r: RouteStatusLike) => !r.is_manifest && r.status === 'active'

/** Why an active route can't be marked completed yet: deliveries are still to be made or failed. */
export function completeBlockedReason(r: RouteStatusLike): string | null {
  const pending = (r.route_stops ?? []).filter(s => (s as { status?: string | null }).status === 'pending').length
  if (pending === 0) return null
  return `${pending} ${pending === 1 ? 'stop is' : 'stops are'} still pending. Complete or fail ${pending === 1 ? 'it' : 'them'} first, or cancel the trip.`
}

/** Dispatch (pending → active) and mark completed, each behind a confirmation. */
export function useRouteStatusActions() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => routesAPI.updateStatus(id, status),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['route', id] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: AxiosError<{ detail?: string }>) => toast.error(err?.response?.data?.detail || 'Failed to update trip status'),
  })

  const dispatch = async (route: RouteStatusLike) => {
    const ok = await confirm({
      title: 'Send this trip to the driver?',
      message: 'The trip becomes active, the vehicle is marked on trip and its driver is told, with a link to the trip.',
      confirmLabel: 'Send to driver',
    })
    if (ok) await mutation.mutateAsync({ id: route.id, status: 'active' }).then(() => toast.success('Trip sent to the driver')).catch(() => undefined)
  }

  const complete = async (route: RouteStatusLike) => {
    const blocked = completeBlockedReason(route)
    if (blocked) { toast.error(blocked); return }
    const ok = await confirm({
      title: 'Mark this trip as completed?',
      message: 'The vehicle becomes available again.',
      confirmLabel: 'Mark completed',
    })
    if (ok) await mutation.mutateAsync({ id: route.id, status: 'completed' }).then(() => toast.success('Trip marked completed')).catch(() => undefined)
  }

  return { dispatch, complete, isPending: mutation.isPending }
}
