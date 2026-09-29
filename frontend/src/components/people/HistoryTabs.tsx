import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Card, CardHeader, EmptyState, StatusPill, Textarea } from '@/components/ui'
import { errorMessage, formatDateTime } from '@/utils/display'
import { humanize } from '@/components/ui'
import { peopleAPI } from '@/services/api'
import { STATUS_TONES, statusLabel, type PersonDetail } from './types'

const ACTION_LABELS: Record<string, string> = {
  profile_update: 'Profile updated',
  profile_updated: 'Profile updated',
  status_change: 'Status changed',
  document_uploaded: 'Document uploaded',
  document_verified: 'Document verified',
  document_rejected: 'Document rejected',
  document_archived: 'Document archived',
  bank_reveal: 'Bank account number revealed',
  bank_added: 'Bank account added',
  bank_updated: 'Bank account updated',
  note_added: 'Note added',
  person_created: 'Profile created',
}
const actionLabel = (a: string) => ACTION_LABELS[a] ?? humanize(a)

/** Status history and everything else that happened to this profile. */
export function ActivityTab({ detail }: { detail: PersonDetail }) {
  const { user, status_history, activity } = detail
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Status history" description={user.last_login ? `Last signed in ${formatDateTime(user.last_login)}` : 'Has not signed in yet'} />
        {status_history.length === 0 ? (
          <EmptyState compact title="No status changes yet" />
        ) : (
          <ol className="divide-y divide-border">
            {status_history.map(h => (
              <li key={h.id} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  {h.from_status && <><StatusPill tone={STATUS_TONES[h.from_status as keyof typeof STATUS_TONES] ?? 'neutral'} dot={false}>{statusLabel(h.from_status)}</StatusPill><span className="text-muted" aria-label="to">→</span></>}
                  <StatusPill tone={STATUS_TONES[h.to_status as keyof typeof STATUS_TONES] ?? 'neutral'} dot={false}>{statusLabel(h.to_status)}</StatusPill>
                </div>
                {h.reason && <p className="mt-1 text-sm text-text">{h.reason}</p>}
                <p className="mt-0.5 text-xs text-muted">{formatDateTime(h.created_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card>
        <CardHeader title="Activity" description="The latest 50 changes to this profile." />
        {activity.length === 0 ? (
          <EmptyState compact title="No activity yet" />
        ) : (
          <ol className="divide-y divide-border">
            {activity.map(a => (
              <li key={a.id} className="px-4 py-3 sm:px-6">
                <p className="text-sm font-medium text-text">{actionLabel(a.action)}</p>
                <p className="text-xs text-muted">{formatDateTime(a.created_at)}{a.actor_name ? ` · ${a.actor_name}` : ''}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

export function NotesTab({ detail }: { detail: PersonDetail }) {
  const { user, notes } = detail
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const add = useMutation({
    mutationFn: () => peopleAPI.addNote(user.id, body.trim()),
    onSuccess: () => { setBody(''); toast.success('Note added'); queryClient.invalidateQueries({ queryKey: ['people'] }) },
    onError: err => toast.error(errorMessage(err, 'We could not add the note. Try again.')),
  })
  return (
    <Card>
      <CardHeader title="Notes" description="Only staff can see these. They cannot be edited or deleted." />
      <form
        className="space-y-3 border-b border-border px-4 py-4 sm:px-6"
        onSubmit={e => { e.preventDefault(); if (body.trim()) add.mutate() }}
      >
        <Textarea label="Add a note" rows={3} value={body} onChange={e => setBody(e.target.value)} />
        <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>Add note</Button>
      </form>
      {notes.length === 0 ? (
        <EmptyState compact title="No notes yet" description="Record anything the next person should know." />
      ) : (
        <ul className="divide-y divide-border">
          {notes.map(n => (
            <li key={n.id} className="px-4 py-3 sm:px-6">
              <p className="whitespace-pre-wrap text-sm text-text">{n.body}</p>
              <p className="mt-1 text-xs text-muted">{n.author_name ?? 'Staff'} · {formatDateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
