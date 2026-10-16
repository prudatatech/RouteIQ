import { useState } from 'react'
import { Button, Checkbox, Modal, Textarea } from '@/components/ui'

/**
 * Flags specific named documents (not a "more details" answer filed as an extra document) with a
 * reason each, instead of rejecting the whole application. Shared by vendor KYC review and logistic
 * company KYC review.
 */
export function FlagDocumentsModal({ open, entityName, noneUploadedLabel = 'No named documents have been uploaded yet.', documents, busy, onClose, onSubmit }: {
  open: boolean
  entityName: string
  /** Shown when `documents` is empty. */
  noneUploadedLabel?: string
  documents: { key: string; label: string }[]
  busy: boolean
  onClose: () => void
  onSubmit: (issues: Record<string, string>) => void
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({})
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
    if (keys.length === 0) { setError('Check at least one document.'); return }
    const missing = keys.find(k => !reasons[k].trim())
    if (missing) { setError(`Say what's wrong with the ${documents.find(d => d.key === missing)?.label ?? missing}.`); return }
    setError(null)
    onSubmit(Object.fromEntries(keys.map(k => [k, reasons[k].trim()])))
  }

  const close = () => { setReasons({}); setError(null); onClose() }

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={`Flag documents for ${entityName}`}
      description="Check each document that needs fixing and say why. The application stays for review - everything else already on it is kept."
      onSubmit={submit}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Send</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {documents.length === 0 ? (
          <p className="text-sm text-muted">{noneUploadedLabel}</p>
        ) : (
          documents.map(d => {
            const checked = d.key in reasons
            return (
              <div key={d.key} className="rounded-control border border-border p-3">
                <Checkbox label={d.label} checked={checked} disabled={busy} onChange={e => toggle(d.key, e.target.checked)} />
                {checked && (
                  <Textarea
                    className="mt-2"
                    label="Reason"
                    hideLabel
                    placeholder={`What's wrong with the ${d.label.toLowerCase()}?`}
                    value={reasons[d.key]}
                    disabled={busy}
                    onChange={e => setReasons(prev => ({ ...prev, [d.key]: e.target.value }))}
                  />
                )}
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}
