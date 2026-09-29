import clsx from 'clsx'
import { initialsOf } from './types'

/** Round photo, or initials when there is no photo. */
export function PersonAvatar({ name, url, size = 'md', className }: {
  name: string | null | undefined
  url?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const box = size === 'lg' ? 'h-16 w-16 text-lg' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
  return url ? (
    <img src={url} alt="" className={clsx('shrink-0 rounded-full object-cover', box, className)} />
  ) : (
    <span aria-hidden="true" className={clsx('flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand', box, className)}>
      {initialsOf(name)}
    </span>
  )
}
