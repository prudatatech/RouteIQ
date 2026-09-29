import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, type ConfirmOptions, type PromptOptions } from './confirmContext'
import { Modal } from './Modal'
import { Button } from './Button'
import { Textarea } from './Field'

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

/** Mount once near the root. Replaces window.confirm / window.prompt / alert. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const [text, setText] = useState('')
  const confirmButton = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((options: ConfirmOptions) =>
    new Promise<boolean>(resolve => setRequest({ kind: 'confirm', options, resolve })), [])

  const prompt = useCallback((options: PromptOptions) =>
    new Promise<string | null>(resolve => { setText(''); setRequest({ kind: 'prompt', options, resolve }) }), [])

  const close = (accepted: boolean) => {
    if (!request) return
    if (request.kind === 'confirm') request.resolve(accepted)
    else request.resolve(accepted ? text.trim() : null)
    setRequest(null)
  }

  const options = request?.options
  const isPrompt = request?.kind === 'prompt'
  const promptOptions = isPrompt ? (request.options as PromptOptions) : null
  const blocked = !!promptOptions?.required && text.trim().length === 0

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      <Modal
        open={!!request}
        onClose={() => close(false)}
        title={options?.title}
        size="sm"
        initialFocus={isPrompt ? undefined : confirmButton}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>{options?.cancelLabel ?? 'Cancel'}</Button>
            <Button
              ref={confirmButton}
              variant={options?.tone === 'danger' ? 'danger' : 'primary'}
              disabled={blocked}
              onClick={() => close(true)}
            >
              {options?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {options?.message && <div className="text-sm text-muted">{options.message}</div>}
        {promptOptions && (
          <Textarea
            data-autofocus
            className={options?.message ? 'mt-4' : undefined}
            label={promptOptions.inputLabel}
            placeholder={promptOptions.placeholder}
            required={promptOptions.required}
            value={text}
            onChange={e => setText(e.target.value)}
          />
        )}
      </Modal>
    </ConfirmContext.Provider>
  )
}
