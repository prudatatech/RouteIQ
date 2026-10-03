import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertCircle, ArrowDown, ArrowUp, Calendar, User } from 'lucide-react'
import { Alert, Checkbox, Input, Select } from '@/components/ui'
import type { LoadDraft, LoadPriority } from '@/types/load'
import { isWeekend, PRIORITIES, taxBasisLocal, todayIso } from './logic'
import type { StepErrors } from './validate'
import AddressBlock from './AddressBlock'

const SLOTS = [
  { value: 'morning', label: 'Morning, 6am–12pm' },
  { value: 'afternoon', label: 'Afternoon, 12–6pm' },
  { value: 'evening', label: 'Evening, 6–10pm' },
]

/** Colour of each priority card when it is chosen. */
const PRIORITY_TONE: Record<LoadPriority, string> = {
  high: 'border-danger bg-danger/5',
  medium: 'border-brand-fill bg-brand-fill/5',
  low: 'border-success bg-success/5',
}

/** Tomorrow as YYYY-MM-DD in the person's own time zone (toISOString would give a UTC date). */
function tomorrowIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return todayIso(d)
}

/** A numbered card for one part of the step. */
function Section({ n, title, description, aside, children }: { n: number; title: string; description: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-6 rounded-card border border-border bg-surface p-6" aria-labelledby={`step1-section-${n}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-fill/20 text-lg font-semibold text-brand-dark" aria-hidden="true">{n}</div>
          <div>
            <h3 id={`step1-section-${n}`} className="text-lg font-semibold text-text">{title}</h3>
            <p className="text-sm text-muted">{description}</p>
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** One end of the trip on the timeline: a coloured marker, then the address block (it has its own summary and Edit). */
function Stop({ side, draft, set, errors, notes }: {
  side: 'pickup' | 'delivery'
  draft: LoadDraft
  set: (patch: Record<string, unknown>) => void
  errors: StepErrors
  notes?: ReactNode
}) {
  const pickup = side === 'pickup'
  const Icon = pickup ? ArrowUp : ArrowDown
  return (
    <div className="flex gap-4">
      <div className={clsx('z-10 mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full text-white ring-4 ring-surface', pickup ? 'bg-success' : 'bg-danger')}>
        <Icon className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2" role="group" aria-label={pickup ? 'Pickup' : 'Delivery'}>
        <span className="text-xs font-semibold uppercase text-muted">{pickup ? 'Pickup' : 'Delivery'}</span>
        <AddressBlock side={side} draft={draft} set={set} errors={errors} />
        {notes}
      </div>
    </div>
  )
}

const PHONE_PREFIX = <span className="-ml-3 flex h-full items-center rounded-l-control border-r border-border bg-surface-subtle px-3 text-sm font-semibold text-text">+91</span>

/** Step 1, Pickup and delivery: the two addresses, the pickup date and slot, who to call at each end, and the priority. */
export default function AddressStep({ draft, onChange, errors, pickupNotes, deliveryNotes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  pickupNotes?: ReactNode
  deliveryNotes?: ReactNode
}) {
  const basis = taxBasisLocal(draft)
  const set = (patch: Record<string, unknown>) => onChange(patch as Partial<LoadDraft>)
  const today = todayIso()
  const tomorrow = tomorrowIso()
  const sameContact = !!draft.pickup_contact_name.trim()
    && draft.delivery_contact_name === draft.pickup_contact_name
    && draft.delivery_contact_phone === draft.pickup_contact_phone
  const chip = (active: boolean) => clsx('rounded-full px-4 py-1.5', active ? 'bg-brand-fill text-brand-dark' : 'hover:bg-surface')

  return (
    <div className="space-y-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="relative space-y-6">
          <div className="absolute bottom-10 left-4 top-10 w-px border-l-2 border-dashed border-border" aria-hidden="true" />
          <Stop side="pickup" draft={draft} set={set} errors={errors} notes={pickupNotes} />
          <Stop side="delivery" draft={draft} set={set} errors={errors} notes={deliveryNotes} />
        </div>
      </div>

      <Section
        n={1} title="Pickup date and time" description="When the logistic company should collect the goods."
        aside={(
          <div className="flex items-center rounded-full border border-border bg-surface-subtle p-1 text-sm font-medium">
            <button type="button" className={chip(draft.pickup_date === today)} onClick={() => onChange({ pickup_date: today })}>Today</button>
            <button type="button" className={chip(draft.pickup_date === tomorrow)} onClick={() => onChange({ pickup_date: tomorrow })}>Tomorrow</button>
          </div>
        )}
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <Input
              label="Pickup date" required type="date" min={today}
              value={draft.pickup_date} onChange={e => onChange({ pickup_date: e.target.value })}
              error={errors.pickup_date} leading={<Calendar size={16} aria-hidden="true" />}
            />
            {draft.pickup_date && isWeekend(draft.pickup_date) && (
              <p className="mt-3 flex items-center gap-1.5 rounded bg-brand-fill/10 px-3 py-2 text-xs font-medium text-brand-dark">
                <AlertCircle size={14} aria-hidden="true" /> Weekends have limited availability.
              </p>
            )}
          </div>
          <Select
            label="Pickup time slot" value={draft.pickup_slot} placeholder="Any time"
            onChange={e => onChange({ pickup_slot: e.target.value as LoadDraft['pickup_slot'] })} options={SLOTS}
            hint="When the driver should arrive"
          />
        </div>
      </Section>

      <Section
        n={2} title="Contacts" description="The driver calls these numbers at pickup and before delivery."
        aside={(
          <Checkbox
            label="Receiver is the same as the pickup contact" checked={sameContact}
            onChange={e => onChange(e.target.checked
              ? { delivery_contact_name: draft.pickup_contact_name, delivery_contact_phone: draft.pickup_contact_phone }
              : { delivery_contact_name: '', delivery_contact_phone: '' })}
          />
        )}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-4 rounded-card border border-border p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> At pickup
            </p>
            <Input
              label="Pickup contact name" required leading={<User size={16} aria-hidden="true" />}
              value={draft.pickup_contact_name} onChange={e => set({ pickup_contact_name: e.target.value })}
              error={errors.pickup_contact_name} autoComplete="off"
            />
            <Input
              label="Pickup contact mobile" required type="tel" inputMode="tel" leading={PHONE_PREFIX} inputClassName="pl-[60px]"
              value={draft.pickup_contact_phone} onChange={e => set({ pickup_contact_phone: e.target.value })}
              error={errors.pickup_contact_phone} autoComplete="off"
            />
          </div>
          <div className="space-y-4 rounded-card border border-border p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text">
              <span className="h-2 w-2 rounded-full bg-brand-fill" aria-hidden="true" /> At delivery
            </p>
            <Input
              label="Receiver name" required leading={<User size={16} aria-hidden="true" />}
              value={draft.delivery_contact_name} onChange={e => set({ delivery_contact_name: e.target.value })}
              error={errors.delivery_contact_name} autoComplete="off"
            />
            <Input
              label="Receiver mobile" required type="tel" inputMode="tel" leading={PHONE_PREFIX} inputClassName="pl-[60px]"
              value={draft.delivery_contact_phone} onChange={e => set({ delivery_contact_phone: e.target.value })}
              error={errors.delivery_contact_phone} autoComplete="off"
            />
          </div>
        </div>
      </Section>

      <fieldset className="space-y-6 rounded-card border border-border bg-surface p-6">
        <legend className="sr-only">Priority</legend>
        <div className="flex gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-fill/20 text-lg font-semibold text-brand-dark" aria-hidden="true">3</div>
          <div>
            <p className="text-lg font-semibold text-text" aria-hidden="true">Priority</p>
            <p className="text-sm text-muted">How quickly you need a truck.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {PRIORITIES.map(p => {
            const chosen = draft.priority === p.value
            return (
              <label
                key={p.value}
                className={clsx(
                  'relative cursor-pointer rounded-lg border-2 p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
                  chosen ? PRIORITY_TONE[p.value] : 'border-border hover:bg-surface-subtle',
                )}
              >
                <input type="radio" name="priority" value={p.value} checked={chosen} onChange={() => onChange({ priority: p.value })} className="sr-only" />
                <span className="block font-semibold text-text">{p.label}{p.value === 'medium' ? ' (default)' : ''}</span>
                <span className="mt-1 block text-xs text-muted">{p.hint}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {basis !== 'unknown' && (
        <Alert tone="info" title={basis === 'inter' ? 'Interstate (IGST)' : 'Within state (CGST + SGST)'}>
          {basis === 'inter'
            ? `${draft.pickup_state_name} to ${draft.delivery_state_name}: IGST applies on the goods.`
            : `Both addresses are in ${draft.pickup_state_name}: CGST and SGST apply, half each.`}
        </Alert>
      )}
    </div>
  )
}
