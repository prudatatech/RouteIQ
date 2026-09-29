import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Send } from 'lucide-react'
import { Button, EmptyState, ErrorState, Spinner, Textarea } from '@/components/ui'
import { messagesAPI, type ChatMessage } from '@/services/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatTimeAgo } from '@/utils/timeFormat'
import { errorMessage } from '@/utils/display'

export type MessageTarget = { route_id: string } | { shipment_id: string }

const MAX_LENGTH = 2000

/**
 * The conversation with the driver on a route or shipment (text only). Opening it
 * marks the driver's messages read, and it updates as messages arrive.
 */
export default function MessagesPanel({ target, unavailable }: {
  target: MessageTarget
  /** Why nobody can be messaged yet (for example, no vehicle assigned). Hides the composer. */
  unavailable?: string
}) {
  const queryClient = useQueryClient()
  const targetKey = 'route_id' in target ? `r:${target.route_id}` : `s:${target.shipment_id}`
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const thread = useQuery({
    queryKey: ['messages', targetKey],
    queryFn: () => messagesAPI.thread(target),
  })

  useRealtimeRefresh(`messages-panel-${targetKey}`, ['messages'], [['messages', targetKey], ['messages-unread']])

  const markRead = useMutation({
    mutationFn: () => messagesAPI.markRead(target),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages-unread'] }),
  })

  const send = useMutation({
    mutationFn: (body: string) => messagesAPI.send(target, body),
    onSuccess: () => {
      setDraft('')
      queryClient.invalidateQueries({ queryKey: ['messages', targetKey] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not send the message. Try again.')),
  })

  const messages = useMemo(() => thread.data ?? [], [thread.data])
  const unreadFromDriver = messages.some(m => m.sender_role === 'driver' && !m.read_at)

  // Read what the driver wrote as soon as it is on screen
  useEffect(() => {
    if (unreadFromDriver && !markRead.isPending) markRead.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadFromDriver, messages.length])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || send.isPending) return
    send.mutate(body)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  if (thread.isLoading) return <div className="flex justify-center py-6"><Spinner size={20} label="Loading messages" /></div>
  if (thread.isError) {
    return <ErrorState compact title="We could not load the messages" description="Check your connection and try again." onRetry={() => thread.refetch()} />
  }

  return (
    <div className="space-y-3">
      <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto rounded-control border border-border bg-surface-subtle p-3" aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState compact title="No messages yet" description="Messages between dispatch and the driver show up here." />
        ) : messages.map(m => <Bubble key={m.id} message={m} />)}
      </div>

      {unavailable ? (
        <p className="text-sm text-muted">{unavailable}</p>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <Textarea
            label="Message to the driver"
            hideLabel
            rows={2}
            maxLength={MAX_LENGTH}
            placeholder="Write to the driver. Enter sends, Shift and Enter adds a line."
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" icon={<Send size={16} />} loading={send.isPending} disabled={!draft.trim()}>Send</Button>
          </div>
        </form>
      )}
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const fromDriver = message.sender_role === 'driver'
  return (
    <div className={clsx('flex flex-col', fromDriver ? 'items-start' : 'items-end')}>
      <div className={clsx('max-w-[85%] rounded-control px-3 py-2 text-sm', fromDriver ? 'bg-surface text-text border border-border' : 'bg-brand-soft text-text')}>
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {fromDriver ? (message.sender_name || 'Driver') : `${message.sender_name || 'Dispatch'}`}
        {message.shipment_tracking_id ? <> · <span className="font-mono">{message.shipment_tracking_id}</span></> : null}
        {' · '}{formatTimeAgo(new Date(message.created_at))}
        {!fromDriver && message.read_at ? ' · Read' : ''}
      </p>
    </div>
  )
}
