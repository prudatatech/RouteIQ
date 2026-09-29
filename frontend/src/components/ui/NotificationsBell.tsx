import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, MessageSquare } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase, openChannel } from '@/services/supabase'
import { messagesAPI, type UnreadThread } from '@/services/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatTimeAgo } from '@/utils/timeFormat'
import { IconButton } from './Button'
import { Spinner } from './Spinner'

interface NotificationRow {
  id: string
  title: string
  body: string
  type: string
  is_read: boolean
  data: Record<string, unknown> | null
  created_at: string
}

/** Where a notification's row takes staff when clicked, per its `type` and `data`. */
const NOTIFICATION_TARGETS: Record<string, { base: string; dataKey: string }> = {
  sos: { base: '/emergency', dataKey: 'alert_id' },
  vendor_request: { base: '/vendor-requests', dataKey: 'request_id' },
  customer_booking: { base: '/bookings', dataKey: 'booking_id' },
  capacity_bid: { base: '/bids', dataKey: 'bid_id' },
  kyc_submitted: { base: '/admin/kyc', dataKey: 'profile_id' },
  tpl_application: { base: '/3pl-partners', dataKey: 'partner_id' },
}

function pathFor(n: NotificationRow): string | null {
  const target = NOTIFICATION_TARGETS[n.type]
  if (!target) return null
  const id = n.data?.[target.dataKey]
  return typeof id === 'string' ? `${target.base}?open=${id}` : target.base
}

const LIST_LIMIT = 20
const MESSAGE_THREADS_SHOWN = 5

/** Where an unread thread takes staff: the route page, or the shipment's drawer. */
const threadPath = (t: UnreadThread) => (t.route_id ? `/routes/${t.route_id}` : `/shipments?open=${t.shipment_id}`)

/** Bell with an unread count, a realtime feed of the signed-in staff member's own notifications
 * (SOS, vendor requests, bids, KYC submissions, 3PL applications — see docs/ux-plan-2.md, D2). */
export function NotificationsBell() {
  const userId = useAuthStore(s => s.userId)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [loading, setLoading] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Unread messages from drivers count towards the badge too
  const messagesUnread = useQuery({
    queryKey: ['messages-unread'],
    queryFn: () => messagesAPI.unread(),
    enabled: !!userId,
    refetchInterval: 60_000,
  })
  useRealtimeRefresh('messages-unread-bell', ['messages'], [['messages-unread']])
  const unreadThreads = messagesUnread.data?.threads ?? []
  const unreadMessages = messagesUnread.data?.total ?? 0
  const unread = unreadNotifications + unreadMessages

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [{ data }, { count }] = await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(LIST_LIMIT),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false),
      ])
      setItems((data as NotificationRow[] | null) ?? [])
      setUnreadNotifications(count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    load()
    const channel = openChannel(`notifications_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, load])

  // Close the panel on Esc or a click outside it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openNotification = async (n: NotificationRow) => {
    if (!n.is_read) {
      setItems(prev => prev.map(i => (i.id === n.id ? { ...i, is_read: true } : i)))
      setUnreadNotifications(c => Math.max(0, c - 1))
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
    }
    setOpen(false)
    const path = pathFor(n)
    if (path) navigate(path)
  }

  const markAllRead = async () => {
    if (!userId || unreadNotifications === 0) return
    setItems(prev => prev.map(i => ({ ...i, is_read: true })))
    setUnreadNotifications(0)
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false)
  }

  return (
    <div className="relative">
      <IconButton
        ref={buttonRef}
        label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        icon={
          <span className="relative inline-flex">
            <Bell size={18} aria-hidden="true" />
            {unread > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-fill px-1 text-xs font-medium leading-none text-on-brand tabular"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
        }
        onClick={() => setOpen(o => !o)}
      />
      {/* Announces unread-count changes without duplicating the visible badge for sighted users. */}
      <span className="sr-only" role="status" aria-live="polite">
        {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'} or message${unread === 1 ? '' : 's'}` : ''}
      </span>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] rounded-card border border-border bg-surface shadow-dialog"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-text">Notifications</p>
            {unreadNotifications > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-brand hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {unreadThreads.length > 0 && (
              <div className="border-b border-border">
                <p className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted">
                  Messages from drivers ({unreadMessages})
                </p>
                <ul>
                  {unreadThreads.slice(0, MESSAGE_THREADS_SHOWN).map(t => (
                    <li key={`${t.route_id ?? ''}${t.shipment_id ?? ''}`}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setOpen(false); navigate(threadPath(t)) }}
                        className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-surface-subtle"
                      >
                        <span className="flex w-full items-center gap-2">
                          <MessageSquare size={14} aria-hidden="true" className="shrink-0 text-brand" />
                          <span className="truncate text-sm font-medium text-text">
                            {t.sender_name || 'Driver'}{t.count > 1 ? ` (${t.count} new)` : ''}
                          </span>
                        </span>
                        <span className="w-full truncate text-xs text-muted">{t.last_body}</span>
                        <span className="text-xs text-muted">{formatTimeAgo(new Date(t.last_at))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {loading && items.length === 0 && (
              <div className="flex justify-center py-6"><Spinner size={20} label="Loading notifications" /></div>
            )}
            {!loading && items.length === 0 && unreadThreads.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted">
                No notifications yet. New SOS alerts, vendor requests, bids and reviews will show up here.
              </p>
            )}
            <ul>
              {items.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openNotification(n)}
                    className={clsx(
                      'flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface-subtle',
                      !n.is_read && 'bg-brand-soft/40',
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      {!n.is_read && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-fill" />}
                      <span className="truncate text-sm font-medium text-text">{n.title}</span>
                    </span>
                    <span className="w-full truncate text-xs text-muted">{n.body}</span>
                    <span className="text-xs text-muted">{formatTimeAgo(new Date(n.created_at))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
