import clsx from 'clsx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand-fill text-on-brand hover:bg-brand-fill-hover',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-subtle',
  ghost: 'bg-transparent text-text hover:bg-neutral-soft',
  danger: 'bg-danger text-white hover:bg-danger-hover',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
}

export const iconSizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
}

export const buttonBase =
  'inline-flex items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-brand'

/** Button styling for elements that are not <button>, such as router links. */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false }: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
} = {}) {
  return clsx(buttonBase, variantClasses[variant], sizeClasses[size], fullWidth && 'w-full')
}
