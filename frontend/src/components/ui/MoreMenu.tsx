import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { MoreHorizontal } from 'lucide-react'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles'
import { anchorPanel, type PanelPosition } from './anchorPanel'
import { nextMenuIndex } from './menuNav'

export interface MoreMenuItem {
  label: string
  icon?: ReactNode
  /** Runs when the item is chosen; the menu closes first. */
  onSelect?: () => void
  /** A link inside the app. */
  to?: string
  /** A link to another site; it opens in a new tab. */
  href?: string
  tone?: 'danger'
  disabled?: boolean
}

const WIDTH = 224

const itemClass = (tone?: 'danger') => clsx(
  'flex h-9 w-full items-center gap-2 rounded-control px-3 text-left text-sm',
  'hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
  tone === 'danger' ? 'text-danger' : 'text-text',
)

/**
 * The "More actions" menu: the one main action stays a button, the rest go here, so a page does not
 * show a row of equal buttons. Opens under the button, closes on a choice, Esc or a click outside;
 * arrow keys move between items.
 */
export function MoreMenu({ items, label = 'More actions', buttonLabel = 'More', variant = 'secondary', size = 'md', align = 'end', className }: {
  items: MoreMenuItem[]
  /** The accessible name of the menu. */
  label?: string
  /** The text on the button. */
  buttonLabel?: string
  variant?: ButtonVariant
  size?: ButtonSize
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) setPosition(anchorPanel(rect, window.innerWidth, WIDTH, align))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, align])

  const placed = position !== null
  // Focus the first item once the menu is on screen
  useEffect(() => {
    if (open && placed) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open, placed])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); return }
    if (e.key === 'Tab') { setOpen(false); return }
    const nodes = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const next = nextMenuIndex(nodes.indexOf(document.activeElement as HTMLElement), e.key, nodes.length)
    if (next !== null) { e.preventDefault(); nodes[next]?.focus() }
  }

  const choose = (item: MoreMenuItem) => {
    setOpen(false)
    item.onSelect?.()
  }

  if (items.length === 0) return null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        className={clsx(buttonClasses({ variant, size }), className)}
      >
        <MoreHorizontal size={size === 'sm' ? 14 : 16} aria-hidden="true" /> {buttonLabel}
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ top: position.top, left: position.left, width: position.width }}
          className="fixed z-40 rounded-control border border-border bg-surface p-1 shadow-raised"
        >
          {items.map(item => {
            const content = <>{item.icon && <span className="shrink-0" aria-hidden="true">{item.icon}</span>}<span className="min-w-0 truncate">{item.label}</span></>
            if (item.to && !item.disabled) {
              return <Link key={item.label} role="menuitem" to={item.to} className={itemClass(item.tone)} onClick={() => choose(item)}>{content}</Link>
            }
            if (item.href && !item.disabled) {
              return <a key={item.label} role="menuitem" href={item.href} target="_blank" rel="noopener noreferrer" className={itemClass(item.tone)} onClick={() => choose(item)}>{content}</a>
            }
            return <button key={item.label} type="button" role="menuitem" disabled={item.disabled} className={itemClass(item.tone)} onClick={() => choose(item)}>{content}</button>
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
