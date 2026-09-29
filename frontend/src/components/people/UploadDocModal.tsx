import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { FileUp, X } from 'lucide-react'
import { peopleAPI } from '@/services/api'
import { uploadPersonDocument } from '@/services/kycDocuments'
import { useAuthStore } from '@/store/authStore'
import { Alert, Button, FileButton, Input, Modal, Select } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { DuplicateNotice } from './DuplicateNotice'
import { useDuplicates } from './useDuplicates'
import { CONSENT_METHODS, DOC_TYPES, LICENCE_CLASSES, docInfo, docLabel, type PersonDetail } from './types'
import { docNumberError, licenceFormatWarning } from './validators'

const ACCEPT = 'application/pdf,image/jpeg,image/png'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_EXTRA = 4
/** Why a file cannot be used, or null. Phones save HEIC by default, so it gets its own message. */
function fileProblem(file: File): string | null {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return 'HEIC photos are not supported here. Send it as JPG or use the driver app, which converts photos.'
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return 'Use a PDF, JPG or PNG file.'
  if (file.size > MAX_BYTES) return 'The file is over 10 MB. Choose a smaller one.'
  return null
}

/** Upload or replace one document: number, dates, front and back pages, with the consent notice and duplicate check. */
export function UploadDocModal({ detail, types, replacing, onClose, onDone }: {
  detail: PersonDetail; types: string[] | null; replacing?: string; onClose: () => void; onDone: () => void
}) {
  const { user, profile } = detail
  const myId = useAuthStore(s => s.userId)
  const options = DOC_TYPES.filter(d => !types || types.includes(d.type))
  const [type, setType] = useState(options.length === 1 ? options[0].type : '')
  const [number, setNumber] = useState('')
  const [classes, setClasses] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [nameOnDoc, setNameOnDoc] = useState(user.full_name ?? '')
  const [issued, setIssued] = useState('')
  const [expires, setExpires] = useState('')
  const [reviewBy, setReviewBy] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [extras, setExtras] = useState<File[]>([])
  const [consent, setConsent] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const info = docInfo(type)
  const needsConsent = !profile?.consent_at
  const numberProblem = info?.needsNumber && number.trim() ? docNumberError(type, number) : null
  const dup = useDuplicates({ doc_type: type, doc_number: number.trim() }, !!info?.needsNumber && !!number.trim() && !numberProblem, user.id)

  const save = useMutation({
    mutationFn: async () => {
      if (needsConsent) {
        await peopleAPI.update(user.id, {
          profile: { consent_method: consent, consent_at: new Date().toISOString(), consent_by: myId },
          updated_at: profile?.updated_at,
        })
      }
      const path = await uploadPersonDocument(user.id, type, file!)
      const extraPaths: string[] = []
      for (const f of extras) extraPaths.push(await uploadPersonDocument(user.id, type, f))
      const metadata: Record<string, unknown> = {}
      if (type === 'driving_licence' && classes.length) metadata.licence_classes = classes
      if (type === 'other') metadata.title = title.trim()
      return peopleAPI.addDocument(user.id, {
        doc_type: type, file_path: path,
        ...(extraPaths.length ? { extra_file_paths: extraPaths } : {}),
        ...(number.trim() ? { doc_number: ['pan', 'voter_id', 'passport'].includes(type) ? number.trim().toUpperCase() : number.trim() } : {}),
        ...(nameOnDoc.trim() ? { name_on_document: nameOnDoc.trim() } : {}),
        ...(issued ? { issued_on: issued } : {}),
        ...(expires ? { expires_on: expires } : {}),
        ...(reviewBy ? { review_by: reviewBy } : {}),
        ...(Object.keys(metadata).length ? { metadata } : {}),
      })
    },
    onSuccess: saved => {
      toast.success('Document uploaded. It is waiting for review')
      for (const message of saved.warning_messages ?? []) toast(message, { duration: 9000 })
      onDone(); onClose()
    },
    onError: err => toast.error(errorMessage(err, 'We could not save the document. Try again.')),
  })

  const submit = () => {
    const e: Record<string, string> = {}
    if (!type) e.type = 'Choose a document type.'
    if (needsConsent && !consent) e.consent = 'Record how they gave consent.'
    if (info?.needsNumber && !number.trim()) e.number = 'Enter the document number.'
    if (numberProblem) e.number = numberProblem
    if (dup.matches.length > 0) e.number = 'This number is already on file for someone else.'
    if (info?.needsExpiry && !expires) e.expires = 'Enter the expiry date.'
    if (issued && expires && expires < issued) e.expires = 'Expiry is before the issue date.'
    if (type === 'driving_licence' && classes.length === 0) e.classes = 'Choose at least one class.'
    if (type === 'other' && !title.trim()) e.title = 'Give this document a title.'
    if (!file) e.file = 'Choose a PDF, JPG or PNG file.'
    else if (fileProblem(file)) e.file = fileProblem(file)!
    const bad = extras.map(fileProblem).find(Boolean)
    if (bad) e.extras = bad
    setErrors(e)
    if (Object.keys(e).length === 0) save.mutate()
  }

  const licenceNote = type === 'driving_licence' && number.trim() && !numberProblem ? licenceFormatWarning(number) : null

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={replacing ? `Replace ${docLabel(replacing).toLowerCase()}` : 'Upload document'}
      description={replacing ? 'The old file is archived and the new one waits for review.' : 'The new document waits for review.'}
      closeOnBackdrop={!save.isPending}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Upload</Button>
        </>
      }
    >
      <div className="space-y-4">
        {needsConsent ? (
          <div className="space-y-2 rounded-control border border-border bg-surface-subtle p-3">
            <p className="text-sm text-text">Before we store any document, record that {user.full_name ?? 'this person'} agreed to their documents being kept.</p>
            <Select label="How did they agree?" required value={consent} onChange={e => setConsent(e.target.value)} error={errors.consent}
              placeholder="Choose a method" options={CONSENT_METHODS} hint="Recorded with your name and today's date." />
          </div>
        ) : (
          <p className="text-xs text-muted">Documents are stored privately. Only staff with access to People can open them. Consent is on record.</p>
        )}

        <Select label="Document type" required value={type} onChange={e => setType(e.target.value)} disabled={options.length === 1} error={errors.type}
          placeholder="Choose a type" options={options.map(d => ({ value: d.type, label: d.label }))} />
        {type === 'other' && <Input label="Title" required value={title} onChange={e => setTitle(e.target.value)} error={errors.title} />}
        {info?.needsNumber && (
          <Input label={`${info.label} number`} required value={number} onChange={e => setNumber(e.target.value)} error={errors.number} autoComplete="off"
            hint={type === 'aadhaar' ? 'Only the last 4 digits are kept and shown afterwards.' : undefined} />
        )}
        <DuplicateNotice matches={dup.matches} what="number" onNavigate={onClose} />
        {licenceNote && <Alert tone="warning">{licenceNote}</Alert>}
        {type === 'driving_licence' && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-text">Licence classes <span className="text-danger" aria-hidden="true">*</span></legend>
            <div className="flex flex-wrap gap-2">
              {LICENCE_CLASSES.map(c => {
                const on = classes.includes(c.value)
                return (
                  <button
                    key={c.value} type="button" aria-pressed={on}
                    onClick={() => setClasses(cs => on ? cs.filter(x => x !== c.value) : [...cs, c.value])}
                    className={clsx('rounded-full border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                      on ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-border bg-surface text-text')}
                  >{c.label}</button>
                )
              })}
            </div>
            {errors.classes && <p role="alert" className="mt-1 text-sm text-danger">{errors.classes}</p>}
            <p className="mt-1 text-xs text-muted">Dispatch warns when a vehicle needs a class the driver does not hold.</p>
          </fieldset>
        )}
        {type && type !== 'photo' && (
          <Input label="Name on the document" value={nameOnDoc} onChange={e => setNameOnDoc(e.target.value)} hint="Copy it exactly. A different spelling shows a warning to whoever verifies it." />
        )}
        {type && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Issue date" type="date" value={issued} onChange={e => setIssued(e.target.value)} />
            {(info?.needsExpiry || type === 'driving_licence') ? (
              <Input label="Expiry date" type="date" required={!!info?.needsExpiry} value={expires} onChange={e => setExpires(e.target.value)} error={errors.expires} />
            ) : (
              <Input label="Review by" type="date" value={reviewBy} onChange={e => setReviewBy(e.target.value)} hint="Optional. Staff are reminded to check it again on this date." />
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <FileButton accept={ACCEPT} icon={<FileUp size={16} />} onFile={setFile}>{file ? 'Choose a different file' : 'Choose file'}</FileButton>
            {file && extras.length < MAX_EXTRA && (
              <FileButton variant="ghost" accept={ACCEPT} onFile={f => setExtras(x => [...x, f])}>Add back page</FileButton>
            )}
          </div>
          <p className="text-sm text-text">{file ? file.name : <span className="text-muted">PDF, JPG or PNG, up to 10 MB.</span>}</p>
          {errors.file && <p role="alert" className="text-sm text-danger">{errors.file}</p>}
          {extras.map((f, i) => (
            <p key={i} className="flex items-center gap-2 text-sm text-text">
              <span className="min-w-0 flex-1 truncate">Page {i + 2}: {f.name}</span>
              <button type="button" className="rounded-control p-1 text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                aria-label={`Remove page ${i + 2}`} onClick={() => setExtras(x => x.filter((_, j) => j !== i))}><X size={14} /></button>
            </p>
          ))}
          {errors.extras && <p role="alert" className="text-sm text-danger">{errors.extras}</p>}
        </div>
      </div>
    </Modal>
  )
}
