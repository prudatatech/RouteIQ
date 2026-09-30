import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Button, Alert, Drawer, Input, StatusPill, Textarea, statusToLabel, useConfirm } from '@/components/ui'
import { cargoKeys, claimsAPI, type CargoClaim, type ClaimPatch, type ClaimStatus } from '@/services/cargo'
import { errorMessage, formatRupees } from '@/utils/display'
import { ConsignmentLink, Steps } from './CargoBits'
import ClaimDocuments from './ClaimDocuments'
import { claimMoveErrors, claimMoves, claimSteps, claimTypeLabel } from './logic'

type Form = {
  claimed: string; approved: string; settled: string
  insurer: string; policy: string; fir: string; surveyor: string; surveyDate: string; notes: string
}

const TERMINAL: ClaimStatus[] = ['settled', 'rejected', 'withdrawn']
const MOVE_LABELS: Record<string, string> = {
  filed: 'Mark filed', surveyed: 'Mark surveyed', approved: 'Approve', rejected: 'Reject', settled: 'Mark settled', withdrawn: 'Withdraw',
}

const numText = (n: number | null) => (n == null ? '' : String(n))
const toForm = (c: CargoClaim): Form => ({
  claimed: numText(c.claimed_amount), approved: numText(c.approved_amount), settled: numText(c.settled_amount),
  insurer: c.insurer ?? '', policy: c.policy_number ?? '', fir: c.fir_number ?? '', surveyor: c.surveyor_name ?? '',
  surveyDate: c.survey_date ? c.survey_date.slice(0, 10) : '', notes: c.notes ?? '',
})

/** '' is empty (null); anything else must be a number of zero or more. */
function parseAmount(text: string): { value: number | null; error?: string } {
  const t = text.trim()
  if (!t) return { value: null }
  const n = Number(t)
  if (!Number.isFinite(n)) return { value: null, error: 'Enter a number.' }
  if (n < 0) return { value: null, error: 'Enter zero or more.' }
  return { value: n }
}

function validate(f: Form): Record<'claimed' | 'approved' | 'settled', string | undefined> {
  const c = parseAmount(f.claimed), a = parseAmount(f.approved), s = parseAmount(f.settled)
  return {
    claimed: c.error,
    approved: a.error ?? (a.value != null && c.value != null && a.value > c.value ? 'Approved cannot be more than claimed.' : undefined),
    settled: s.error ?? (s.value != null && a.value != null && s.value > a.value ? 'Settled cannot be more than approved.' : undefined),
  }
}

function diff(claim: CargoClaim, f: Form): ClaimPatch {
  const patch: ClaimPatch = {}
  const text = (v: string) => v.trim() || null
  const amounts: [keyof ClaimPatch, string, number | null][] = [
    ['claimed_amount', f.claimed, claim.claimed_amount], ['approved_amount', f.approved, claim.approved_amount], ['settled_amount', f.settled, claim.settled_amount],
  ]
  for (const [key, raw, old] of amounts) {
    const v = parseAmount(raw).value
    if (v !== old) Object.assign(patch, { [key]: v })
  }
  const texts: [keyof ClaimPatch, string, string | null][] = [
    ['insurer', f.insurer, claim.insurer], ['policy_number', f.policy, claim.policy_number], ['fir_number', f.fir, claim.fir_number],
    ['surveyor_name', f.surveyor, claim.surveyor_name], ['survey_date', f.surveyDate, claim.survey_date ? claim.survey_date.slice(0, 10) : null],
    ['notes', f.notes, claim.notes],
  ]
  for (const [key, raw, old] of texts) {
    if (text(raw) !== (old ?? null)) Object.assign(patch, { [key]: text(raw) })
  }
  return patch
}

function ClaimForm({ claim }: { claim: CargoClaim }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [form, setForm] = useState<Form>(() => toForm(claim))
  const [blockers, setBlockers] = useState<string[]>([])
  const readOnly = TERMINAL.includes(claim.status)
  const errors = useMemo(() => validate(form), [form])
  const invalid = Object.values(errors).some(Boolean)
  const patch = useMemo(() => diff(claim, form), [claim, form])
  const dirty = Object.keys(patch).length > 0
  const set = (key: keyof Form) => (value: string) => { setForm(f => ({ ...f, [key]: value })); setBlockers([]) }

  const refresh = () => queryClient.invalidateQueries({ queryKey: cargoKeys.all })
  const save = useMutation({
    mutationFn: (body: ClaimPatch) => claimsAPI.update(claim.id, body),
    onSuccess: (_d, body) => { toast.success(body.status ? `Claim ${statusToLabel(body.status).toLowerCase()}.` : 'Claim details saved.'); refresh() },
    onError: (err, body) => toast.error(errorMessage(err, body.status ? 'We could not update the claim status.' : 'We could not save the claim details.')),
  })

  const move = async (to: ClaimStatus) => {
    const missing = claimMoveErrors(to, {
      approved_amount: parseAmount(form.approved).value, settled_amount: parseAmount(form.settled).value,
      surveyor_name: form.surveyor, insurer: form.insurer,
    })
    if (missing.length) { setBlockers(missing); return }
    if (to === 'rejected' || to === 'withdrawn') {
      const ok = await confirm({
        tone: 'danger',
        title: to === 'rejected' ? 'Reject this claim?' : 'Withdraw this claim?',
        message: 'The claim will be closed and can no longer be edited.',
        confirmLabel: to === 'rejected' ? 'Reject claim' : 'Withdraw claim',
      })
      if (!ok) return
    }
    save.mutate({ status: to, ...patch })
  }

  const moves = claimMoves(claim.status)
  const amountInput = (key: 'claimed' | 'approved' | 'settled', label: string) => (
    <Input
      label={label} type="number" inputMode="decimal" min={0} step="any" leading="₹" value={form[key]} disabled={readOnly}
      error={errors[key]} onChange={e => set(key)(e.target.value)}
    />
  )

  return (
    <div className="space-y-6">
      <Steps steps={claimSteps(claim.status)} label="Claim progress" />

      {claim.exception_id && (
        <p className="text-sm">Raised from <Link to={`/cargo/exceptions/${claim.exception_id}`} className="text-brand hover:underline">the problem case</Link>.</p>
      )}

      <section className="space-y-3" aria-label="Amounts">
        <h3 className="text-sm font-semibold text-text">Amounts</h3>
        <p className="text-sm text-muted">Declared value: <span className="tabular font-medium text-text">{claim.declared_value != null ? formatRupees(claim.declared_value) : '—'}</span></p>
        <div className="grid gap-3 sm:grid-cols-3">
          {amountInput('claimed', 'Claimed')}
          {amountInput('approved', 'Approved')}
          {amountInput('settled', 'Settled')}
        </div>
      </section>

      <section className="space-y-3" aria-label="Insurance and survey">
        <h3 className="text-sm font-semibold text-text">Insurance and survey</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Insurer" value={form.insurer} disabled={readOnly} onChange={e => set('insurer')(e.target.value)} />
          <Input label="Policy number" value={form.policy} disabled={readOnly} onChange={e => set('policy')(e.target.value)} />
          <Input label="FIR number" value={form.fir} disabled={readOnly} onChange={e => set('fir')(e.target.value)} />
          <Input label="Surveyor name" value={form.surveyor} disabled={readOnly} onChange={e => set('surveyor')(e.target.value)} />
          <Input label="Survey date" type="date" value={form.surveyDate} disabled={readOnly} onChange={e => set('surveyDate')(e.target.value)} />
        </div>
        <Textarea label="Notes" value={form.notes} disabled={readOnly} onChange={e => set('notes')(e.target.value)} />
        {!readOnly && (
          <Button variant="secondary" disabled={!dirty || invalid || save.isPending} loading={save.isPending && !save.variables?.status} onClick={() => save.mutate(patch)}>
            Save details
          </Button>
        )}
      </section>

      {!readOnly && moves.length > 0 && (
        <section className="space-y-3" aria-label="Move the claim">
          <h3 className="text-sm font-semibold text-text">Next step</h3>
          {blockers.length > 0 && (
            <Alert tone="warning" title="Fill this in first">
              <ul className="list-disc pl-4">{blockers.map(b => <li key={b}>{b}</li>)}</ul>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {moves.map(to => (
              <Button
                key={to} variant={to === 'rejected' || to === 'withdrawn' ? 'danger' : to === moves[0] ? 'primary' : 'secondary'}
                disabled={invalid || save.isPending} loading={save.isPending && save.variables?.status === to} onClick={() => move(to)}
              >
                {MOVE_LABELS[to] ?? statusToLabel(to)}
              </Button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3" aria-label="Documents">
        <h3 className="text-sm font-semibold text-text">Documents</h3>
        <ClaimDocuments claim={claim} readOnly={readOnly} onSaved={refresh} />
      </section>
    </div>
  )
}

/** A claim known only by id (a case page lists claims in short form): loads it, then shows the drawer. */
export function ClaimDrawerById({ id, onClose }: { id: string | null; onClose: () => void }) {
  const claim = useQuery({ queryKey: cargoKeys.claim(id ?? ''), queryFn: () => claimsAPI.get(id!), enabled: !!id })
  if (id && claim.isError) {
    return (
      <Drawer open onClose={onClose} title="Claim">
        <Alert tone="danger" title="We could not load this claim">{errorMessage(claim.error, 'Check your connection and try again.')}</Alert>
      </Drawer>
    )
  }
  return <ClaimDrawer claim={id ? claim.data ?? null : null} onClose={onClose} />
}

/** One claim: progress, amounts, insurance details, status moves and documents. */
export default function ClaimDrawer({ claim, onClose }: { claim: CargoClaim | null; onClose: () => void }) {
  return (
    <Drawer
      open={!!claim}
      onClose={onClose}
      size="lg"
      title={claim?.code ?? 'Claim'}
      description={claim && (
        <span className="flex flex-wrap items-center gap-2">
          <span>{claimTypeLabel(claim.claim_type)} claim</span>
          <StatusPill status={claim.status} />
          <ConsignmentLink c={claim} />
        </span>
      )}
    >
      {/* Keyed so the form restarts from the saved claim after every save. */}
      {claim && <ClaimForm key={`${claim.id}:${claim.updated_at ?? ''}`} claim={claim} />}
    </Drawer>
  )
}
