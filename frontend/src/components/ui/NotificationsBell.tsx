import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Bell } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
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

/** Bell with an unread count, a realtime feed of the signed-in staff member's own notifications
 * (SOS, vendor requests, bids, KYC submissions, 3PL applications — see docs/ux-plan-2.md, D2). */
export function NotificationsBell() {
  const userId = useAuthStore(s => s.userId)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [{ data }, { count }] = await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(LIST_LIMIT),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false),
      ])
      setItems((data as NotificationRow[] | null) ?? [])
      setUnread(count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    load()
    const channel = supabase
      .channel(`notifications_${userId}`)
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
      setUnread(c => Math.max(0, c - 1))
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
    }
    setOpen(false)
    const path = pathFor(n)
    if (path) navigate(path)
  }

  const markAllRead = async () => {
    if (!userId || unread === 0) return
    setItems(prev => prev.map(i => ({ ...i, is_read: true })))
    setUnread(0)
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
        {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : ''}
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
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-brand hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="flex justify-center py-6"><Spinner size={20} label="Loading notifications" /></div>
            )}
            {!loading && items.length === 0 && (
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
