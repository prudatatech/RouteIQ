import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { AxiosError } from 'axios'
import { routesAPI } from '@/services/api'
import { useConfirm } from '@/components/ui'

interface RouteStatusLike {
  id: string
  status: string
  is_manifest?: boolean
}

/** Cargo-manifest routes are shown as routes but live in another table; PATCH /routes/:id/status can't change them. */
export const canDispatchRoute = (r: RouteStatusLike) => !r.is_manifest && r.status === 'pending'
export const canCompleteRoute = (r: RouteStatusLike) => !r.is_manifest && (r.status === 'active' || r.status === 'in_progress')

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
    onError: (err: AxiosError<{ detail?: string }>) => toast.error(err?.response?.data?.detail || 'Failed to update route status'),
  })

  const dispatch = async (route: RouteStatusLike) => {
    const ok = await confirm({
      title: 'Dispatch this route?',
      message: 'The route becomes active, the vehicle is marked on route and its driver is notified.',
      confirmLabel: 'Dispatch',
    })
    if (ok) await mutation.mutateAsync({ id: route.id, status: 'active' }).then(() => toast.success('Route dispatched')).catch(() => undefined)
  }

  const complete = async (route: RouteStatusLike) => {
    const ok = await confirm({
      title: 'Mark this route as completed?',
      message: 'The vehicle becomes available again.',
      confirmLabel: 'Mark completed',
    })
    if (ok) await mutation.mutateAsync({ id: route.id, status: 'completed' }).then(() => toast.success('Route marked completed')).catch(() => undefined)
  }

  return { dispatch, complete, isPending: mutation.isPending }
}
