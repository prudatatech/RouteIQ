import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, MessageSquare } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase, openChannel } from '@/services/supabase'
import { messagesAPI, type UnreadThread } from '@/services/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { IconButton } from './Button'
import { Spinner } from './Spinner'
import { notificationPath, type NotificationAudience } from './notificationTargets'
import { formatRelative } from '@/utils/display'

interface NotificationRow {
  id: string
  title: string
  body: string
  type: string
  is_read: boolean
  data: Record<string, unknown> | null
  created_at: string
}

const LIST_LIMIT = 20
const MESSAGE_THREADS_SHOWN = 5

/** Where an unread thread takes staff: the route page, or the shipment's drawer. */
const threadPath = (t: UnreadThread) => (t.route_id ? `/routes/${t.route_id}` : `/shipments/${encodeURIComponent(String(t.shipment_id))}`)

/** Bell with an unread count and a realtime feed of the signed-in user's own notifications. Staff get
 * SOS, vendor requests, bids, KYC and 3PL activity (see docs/ux-plan-2.md, D2) and drivers' messages;
 * shippers and 3PL partners get what happens to their loads, bids, KYC and offers. */
export function NotificationsBell({ placement = 'left' }: { placement?: 'left' | 'right' } = {}) {
  const userId = useAuthStore(s => s.userId)
  const role = useAuthStore(s => s.role)
  // Vendors and 3PL partners both sign in with the vendor role; drivers' messages are for staff only
  const audience: NotificationAudience = role === 'vendor' ? 'vendor' : 'staff'
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Unread messages from drivers count towards the badge too
  const messagesUnread = useQuery({
    queryKey: ['messages-unread'],
    queryFn: () => messagesAPI.unread(),
    enabled: !!userId && audience === 'staff',
    refetchInterval: 60_000,
  })
  useRealtimeRefresh('messages-unread-bell', ['messages'], [['messages-unread']])
  const unreadThreads = messagesUnread.data?.threads ?? []
  const unreadMessages = messagesUnread.data?.total ?? 0
  const unread = unreadNotifications + unreadMessages

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [{ data, error }, { count }] = await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(LIST_LIMIT),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false),
      ])
      setLoadFailed(!!error)
      if (!error) {
        setItems((data as NotificationRow[] | null) ?? [])
        setUnreadNotifications(count ?? 0)
      }
    } catch {
      setLoadFailed(true)
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openNotification = async (n: NotificationRow) => {
    setOpen(false)
    const path = notificationPath(n, audience)
    if (path) navigate(path)
    if (!n.is_read) {
      setItems(prev => prev.map(i => (i.id === n.id ? { ...i, is_read: true } : i)))
      setUnreadNotifications(c => Math.max(0, c - 1))
      // Go to the page first; marking it read happens in the background.
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      if (error) load()
    }
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
          role="region"
          aria-label="Notifications"
          className={clsx(
            'absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-card border border-border bg-surface shadow-dialog',
            placement === 'left' && 'lg:left-0 lg:right-auto',
          )}
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
                <p className="px-4 pt-3 text-xs font-medium text-muted">
                  Messages from drivers ({unreadMessages})
                </p>
                <ul>
                  {unreadThreads.slice(0, MESSAGE_THREADS_SHOWN).map(t => (
                    <li key={`${t.route_id ?? ''}${t.shipment_id ?? ''}`}>
                      <button
                        type="button"
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
                        <span className="text-xs text-muted">{formatRelative(t.last_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {loading && items.length === 0 && (
              <div className="flex justify-center py-6"><Spinner size={20} label="Loading notifications" /></div>
            )}
            {!loading && loadFailed && (
              <p role="alert" className="px-4 py-4 text-center text-sm text-danger">
                We could not load your notifications.{' '}
                <button type="button" onClick={load} className="font-medium underline">Try again</button>
              </p>
            )}
            {!loading && !loadFailed && items.length === 0 && unreadThreads.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted">
                {audience === 'vendor'
                  ? 'No notifications yet. Updates on your loads, bids, offers and verification will show up here.'
                  : 'No notifications yet. New SOS alerts, vendor loads, bids and reviews will show up here.'}
              </p>
            )}
            <ul>
              {items.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
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
                    <span className="text-xs text-muted">{formatRelative(n.created_at)}</span>
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
