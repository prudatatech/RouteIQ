import { Select } from '@/components/ui'
import { SLA_COMMITMENT_OPTIONS, TAX_TREATMENT_OPTIONS } from './constants'

/** SLA commitment and GTA tax treatment fields, shared by onboarding and the partner settings tab. */
export function OperationalTermsFields({ slaCommitment, taxTreatment, onSlaChange, onTaxChange }: {
  slaCommitment: string
  taxTreatment: string
  onSlaChange: (value: string) => void
  onTaxChange: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <Select
        label="Default SLA commitment"
        hint="Maximum time to respond to a broadcast request."
        options={SLA_COMMITMENT_OPTIONS.map(o => ({ value: o, label: o }))}
        value={slaCommitment}
        onChange={e => onSlaChange(e.target.value)}
      />
      <Select
        label="GTA tax treatment"
        hint="Determines reverse-charge liability on your invoices."
        options={TAX_TREATMENT_OPTIONS.map(o => ({ value: o, label: o }))}
        value={taxTreatment}
        onChange={e => onTaxChange(e.target.value)}
      />
    </div>
  )
}
