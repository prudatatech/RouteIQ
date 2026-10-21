import { useState } from 'react'
import { Button, Checkbox, Modal, Textarea } from '@/components/ui'

export interface DetailFieldOption {
  key: string
  label: string
  currentValue?: string | null
}

export const TPL_FIELD_LABELS: Record<string, string> = {
  company_name: 'Company Name',
  contact_name: 'Contact Person',
  phone: 'Contact Phone',
  pan_number: 'Company PAN',
  gstin: 'GSTIN',
  entity_type: 'Entity Type',
  cin: 'CIN',
  authorized_signatory_name: 'Authorized Signatory',
  bank_account_no: 'Bank Account Number',
  bank_ifsc: 'Bank IFSC Code',
}

/**
 * Flags specific application details (e.g. company name, PAN, GSTIN, bank details, CIN, etc.)
 * with an individual reason for each, instead of rejecting the whole application.
 */
export function FlagDetailsModal({
  open,
  entityName,
  fields,
  initialIssues,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  entityName: string
  fields: DetailFieldOption[]
  initialIssues?: Record<string, string> | null
  busy: boolean
  onClose: () => void
  onSubmit: (issues: Record<string, string>) => void
}) {
  const [reasons, setReasons] = useState<Record<string, string>>(() => initialIssues ?? {})
  const [error, setError] = useState<string | null>(null)

  const toggle = (key: string, checked: boolean) => {
    setReasons(prev => {
      const next = { ...prev }
      if (checked) next[key] = next[key] ?? ''
      else delete next[key]
      return next
    })
    if (error) setError(null)
  }

  const submit = () => {
    const keys = Object.keys(reasons)
    if (keys.length === 0) {
      setError('Select at least one detail to flag.')
      return
    }
    const missing = keys.find(k => !reasons[k].trim())
    if (missing) {
      const label = fields.find(f => f.key === missing)?.label ?? missing
      setError(`Please state what needs to be fixed for ${label}.`)
      return
    }
    setError(null)
    onSubmit(Object.fromEntries(keys.map(k => [k, reasons[k].trim()])))
  }

  const close = () => {
    setReasons({})
    setError(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={`Flag application details for ${entityName}`}
      description="Select each detail field that requires revision and specify the reason. The partner will see these highlighted with instructions to correct them."
      onSubmit={submit}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Submit flags</Button>
        </>
      )}
    >
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {fields.map(f => {
          const checked = f.key in reasons
          return (
            <div key={f.key} className="rounded-control border border-border p-3 transition-colors bg-surface hover:bg-surface-subtle">
              <div className="flex items-start justify-between gap-2">
                <Checkbox
                  label={f.label}
                  checked={checked}
                  disabled={busy}
                  onChange={e => toggle(f.key, e.target.checked)}
                />
                {f.currentValue && (
                  <span className="font-mono text-xs text-muted truncate max-w-[200px]" title={f.currentValue}>
                    {f.currentValue}
                  </span>
                )}
              </div>
              {checked && (
                <Textarea
                  className="mt-2.5"
                  label={`Reason for ${f.label}`}
                  hideLabel
                  placeholder={`What needs to be corrected in ${f.label.toLowerCase()}?`}
                  value={reasons[f.key]}
                  disabled={busy}
                  onChange={e => setReasons(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
