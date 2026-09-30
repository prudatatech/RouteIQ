import type { ReactNode } from 'react'
import clsx from 'clsx'
import { CheckCircle2, MapPin, ShieldAlert, StickyNote, Truck, Wrench, Zap } from 'lucide-react'
import { humanize } from '@/components/ui'
import { formatDateTime } from '@/utils/display'
import type { CaseTimelineEntry, CustodyEvent } from '@/services/cargo'
import { ConditionPill } from './CargoBits'
import { custodyKindLabel, holderLabel } from './logic'

/** Photo and signature thumbnails; each opens the full image in a new tab. */
function Thumbnails({ photos, signature, label }: { photos?: string[] | null; signature?: string | null; label: string }) {
  const list = (photos ?? []).filter(Boolean)
  if (list.length === 0 && !signature) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {list.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="block rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          <img src={url} alt={`${label}: photo ${i + 1}`} loading="lazy" className="h-16 w-16 rounded-control border border-border object-cover" />
        </a>
      ))}
      {signature && (
        <a href={signature} target="_blank" rel="noreferrer" className="block rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          <img src={signature} alt={`${label}: signature`} loading="lazy" className="h-16 w-28 rounded-control border border-border bg-white object-contain" />
        </a>
      )}
    </div>
  )
}

function Rail({ items }: { items: { key: string; dot: ReactNode; body: ReactNode }[] }) {
  return (
    <ol className="space-y-0">
      {items.map((item, i) => {
        const last = i === items.length - 1
        return (
          <li key={item.key} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted" aria-hidden="true">{item.dot}</span>
              {!last && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
            </div>
            <div className={clsx('min-w-0 flex-1', !last && 'pb-5')}>{item.body}</div>
          </li>
        )
      })}
    </ol>
  )
}

const pcs = (n: number | null | undefined) => (n == null ? null : `${n.toLocaleString('en-IN')} ${n === 1 ? 'piece' : 'pieces'}`)

/** Who held the goods before and after an event, in words. */
function movement(e: CustodyEvent): string | null {
  const side = (holder: string | null, plate?: string | null, depot?: string | null) =>
    holder === 'vehicle' && plate ? plate : holder === 'hub' && depot ? depot : holder ? holderLabel(holder).replace(/^(On a|At a|With the) /, '') : null
  const from = side(e.from_holder, e.from_vehicle_plate, e.from_depot_name)
  const to = side(e.to_holder, e.to_vehicle_plate, e.to_depot_name)
  if (from && to && from !== to) return `${from} → ${to}`
  return to ?? from
}

/** The custody chain of one consignment, oldest first: every handover with count, condition, proof and who recorded it. */
export function CustodyTimeline({ events, className }: { events: CustodyEvent[]; className?: string }) {
  const ordered = [...events].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
  return (
    <div className={className} aria-label="Custody history">
      <Rail
        items={ordered.map(e => {
          const trouble = !!e.condition && e.condition !== 'good'
          const facts = [
            pcs(e.pieces),
            e.weight_kg != null ? `${e.weight_kg.toLocaleString('en-IN')} kg` : null,
            movement(e),
            e.receiver_name ? `Received by ${e.receiver_name}` : null,
            e.seal_number ? `Seal ${e.seal_number}${e.seal_ok === false ? ' (not intact)' : e.seal_ok ? ' (intact)' : ''}` : null,
            e.otp_verified ? 'OTP checked' : null,
          ].filter(Boolean)
          const who = [e.recorded_by_name, e.recorded_role ? humanize(e.recorded_role) : null].filter(Boolean).join(' · ')
          return {
            key: e.id,
            dot: trouble ? <ShieldAlert size={13} className="text-danger" /> : e.kind === 'delivery' ? <CheckCircle2 size={13} className="text-success" /> : <Truck size={13} />,
            body: (
              <>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-text">{custodyKindLabel(e.kind)}</span>
                  {e.condition && <ConditionPill condition={e.condition} />}
                  <span className="text-xs text-muted">{formatDateTime(e.recorded_at)}</span>
                </div>
                {facts.length > 0 && <p className="mt-0.5 text-sm text-text">{facts.join(' · ')}</p>}
                {(who || e.notes) && <p className="mt-0.5 text-xs text-muted">{[who, e.notes].filter(Boolean).join(' · ')}</p>}
                {e.lat != null && e.lng != null && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand hover:underline"
                  >
                    <MapPin size={12} aria-hidden="true" /> {e.lat.toFixed(4)}, {e.lng.toFixed(4)}
                  </a>
                )}
                <Thumbnails photos={e.photo_urls} signature={e.signature_url} label={custodyKindLabel(e.kind)} />
              </>
            ),
          }
        })}
      />
    </div>
  )
}

const SOURCE_ICON: Record<string, ReactNode> = {
  custody: <Truck size={13} />,
  sos: <ShieldAlert size={13} className="text-danger" />,
  maintenance: <Wrench size={13} />,
  note: <StickyNote size={13} />,
  action: <Zap size={13} className="text-brand" />,
}
const SOURCE_LABEL: Record<string, string> = { custody: 'Custody', sos: 'SOS', maintenance: 'Maintenance', note: 'Note', action: 'Action' }

/** A case's merged timeline (custody, SOS, maintenance, actions and notes), oldest first. */
export function CaseTimeline({ entries }: { entries: CaseTimelineEntry[] }) {
  const ordered = [...entries].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return (
    <div aria-label="Case history">
      <Rail
        items={ordered.map(e => {
          const title = e.title || (e.source === 'custody' ? custodyKindLabel(e.kind) : humanize(e.kind))
          const who = [e.actor_name, e.actor_role ? humanize(e.actor_role) : null].filter(Boolean).join(' · ')
          return {
            key: e.id,
            dot: SOURCE_ICON[e.source] ?? <StickyNote size={13} />,
            body: (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-text">{title}</span>
                  <span className="text-xs text-muted">{SOURCE_LABEL[e.source] ?? humanize(e.source)} · {formatDateTime(e.at)}</span>
                </div>
                {e.note && <p className="mt-0.5 whitespace-pre-line break-words text-sm text-text">{e.note}</p>}
                {who && <p className="mt-0.5 text-xs text-muted">{who}</p>}
                <Thumbnails photos={e.photo_urls} signature={e.signature_url} label={title} />
              </>
            ),
          }
        })}
      />
    </div>
  )
}
