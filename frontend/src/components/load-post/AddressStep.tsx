import type { ReactNode } from 'react'
import { Alert } from '@/components/ui'
import type { LoadDraft } from '@/types/load'
import { taxBasisLocal } from './logic'
import type { StepErrors } from './validate'
import SiteCard from './SiteCard'

/** Step 1, Route and dates: where the goods are collected and delivered, when, who to call and what each site needs. */
export default function AddressStep({ draft, onChange, errors, pickupNotes, deliveryNotes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  pickupNotes?: ReactNode
  deliveryNotes?: ReactNode
}) {
  const basis = taxBasisLocal(draft)
  return (
    <div className="space-y-3">
      {/* Side by side from md; on wide screens the pair breaks out of the 720px form column so each side has room. */}
      <div className="grid gap-3 md:grid-cols-2 md:items-start lg:relative lg:left-1/2 lg:w-[min(60rem,calc(100vw-6rem))] lg:-translate-x-1/2">
        <SiteCard side="pickup" draft={draft} onChange={onChange} errors={errors} notes={pickupNotes} />
        <SiteCard side="delivery" draft={draft} onChange={onChange} errors={errors} notes={deliveryNotes} />
      </div>
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
