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
    <div className="space-y-4">
      <SiteCard side="pickup" draft={draft} onChange={onChange} errors={errors} notes={pickupNotes} />
      <SiteCard side="delivery" draft={draft} onChange={onChange} errors={errors} notes={deliveryNotes} />
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
