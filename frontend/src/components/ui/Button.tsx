import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { Spinner } from './Spinner'
import {
  buttonBase, buttonClasses, iconSizeClasses, variantClasses,
  type ButtonSize, type ButtonVariant,
} from './buttonStyles'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and blocks clicks while an action runs. */
  loading?: boolean
  icon?: ReactNode
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, fullWidth, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(buttonClasses({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 16} tone={variant === 'danger' ? 'inverse' : 'current'} /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also shown as the tooltip. Required because the button has no text. */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={clsx(buttonBase, variantClasses[variant], iconSizeClasses[size], 'shrink-0', className)}
      {...props}
    >
      {icon}
    </button>
  )
})
