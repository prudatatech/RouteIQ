import { createContext, useContext, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: ReactNode
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` for destructive or irreversible actions. */
  tone?: 'primary' | 'danger'
}

export interface PromptOptions extends ConfirmOptions {
  /** Label of the text box, for example "Reason for rejection". */
  inputLabel: string
  placeholder?: string
  /** When true the confirm button stays disabled until something is typed. */
  required?: boolean
}

export const ConfirmContext = createContext<{
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
} | null>(null)

/** `const { confirm, prompt } = useConfirm(); if (await confirm({ title: 'Delete route?' })) …` */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}
