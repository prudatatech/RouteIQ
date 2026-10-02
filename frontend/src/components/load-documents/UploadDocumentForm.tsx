import { useEffect, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { Button, FileButton, Input, Modal, Select } from '@/components/ui'
import type { LoadDocument, UploadKind } from '@/types/loadDocuments'
import {
  KIND_LABELS, UPLOAD_KINDS, emptyUpload, validateUpload, valuesFromDocument, type UploadErrors, type UploadValues,
} from './model'

/** Add an invoice, challan or e-way bill, or correct one that is already there. The file is optional. */
export function UploadDocumentForm({ open, existing, busy, onClose, onSubmit }: {
  open: boolean
  /** Set to correct a document instead of adding one. */
  existing?: LoadDocument | null
  busy: boolean
  onClose: () => void
  onSubmit: (values: UploadValues, file: File | null) => Promise<unknown> | void
}) {
  const [values, setValues] = useState<UploadValues>(emptyUpload())
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<UploadErrors>({})

  useEffect(() => {
    if (!open) return
    setValues(existing ? valuesFromDocument(existing) : emptyUpload())
    setFile(null)
    setErrors({})
  }, [open, existing])

  const set = <K extends keyof UploadValues>(key: K, value: UploadValues[K]) => setValues(v => ({ ...v, [key]: value }))
  const text = (key: keyof UploadValues) => ({
    value: values[key], error: errors[key], onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
  })
  const eway = values.kind === 'eway_bill'

  const submit = async () => {
    const found = validateUpload(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    await onSubmit(values, file)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? `Update ${KIND_LABELS[values.kind].toLowerCase()}` : 'Add a document'}
      description={eway ? 'Record the e-way bill. Attach the PDF if you have it.' : 'Add the details. Attach the PDF if you have it.'}
      closeOnBackdrop={false}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{existing ? 'Save changes' : 'Save document'}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!existing && (
          <Select className="sm:col-span-2" label="Document type" value={values.kind}
            onChange={e => setValues({ ...emptyUpload(e.target.value as UploadKind) })}
            options={UPLOAD_KINDS.map(k => ({ value: k, label: KIND_LABELS[k] }))} />
        )}
        <Input label={eway ? 'E-way bill number' : 'Document number'} required inputMode={eway ? 'numeric' : undefined}
          maxLength={eway ? 12 : undefined} hint={eway ? '12 digits' : undefined} {...text('number')} />
        <Input label={eway ? 'Generated on' : 'Document date'} type="date" required {...text('doc_date')} />

        {eway ? (
          <>
            <Input label="Valid until" type="date" required {...text('valid_until')} />
            <Input label="Linked invoice or challan" placeholder="Invoice number" {...text('linked_document')} />
            <Input label="Transporter ID" {...text('transporter_id')} />
            <Input label="Transporter name" {...text('transporter_name')} />
            <Input label="Vehicle number" placeholder="MH12AB1234" {...text('vehicle_number')} />
            <Input label="Distance" type="number" inputMode="decimal" min="0" trailing="km" {...text('distance_km')} />
          </>
        ) : (
          <>
            <Input label="Seller name" {...text('seller_name')} />
            <Input label="Seller GSTIN" {...text('seller_gstin')} />
            <Input label="Buyer name" {...text('buyer_name')} />
            <Input label="Buyer GSTIN" {...text('buyer_gstin')} />
            <Input label="Dispatch from" {...text('from_address')} />
            <Input label="Ship to" {...text('to_address')} />
            <Input label="Total value" type="number" inputMode="decimal" min="0" leading="₹" {...text('total_value')} />
          </>
        )}

        <div className="sm:col-span-2">
          <FileButton accept="application/pdf,image/*" icon={<Paperclip size={16} />} onFile={setFile}>
            {file ? 'Change file' : 'Attach PDF or photo'}
          </FileButton>
          {file && <p className="mt-1 break-all text-xs text-muted">{file.name}</p>}
        </div>
      </div>
    </Modal>
  )
}
