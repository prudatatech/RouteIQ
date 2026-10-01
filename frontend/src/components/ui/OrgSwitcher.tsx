import { Building2 } from 'lucide-react'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { groupMemberships } from '@/utils/orgs'

/**
 * The active organisation in the header. One membership shows its name; more than one shows a
 * switcher grouped by kind. Nothing shows when the user has no organisations (older backend).
 */
export function OrgSwitcher({ className }: { className?: string }) {
  const memberships = useOrgStore(s => s.memberships)
  const active = useOrgStore(selectActiveMembership)
  const setActiveOrg = useOrgStore(s => s.setActiveOrg)
  if (!active) return null

  if (memberships.length < 2) {
    return (
      <div className={className}>
        <span className="flex items-center gap-2 text-sm font-medium text-text">
          <Building2 size={16} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="truncate">{active.org.name}</span>
        </span>
      </div>
    )
  }

  return (
    <div className={className}>
      <label className="flex items-center gap-2 text-sm">
        <Building2 size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="sr-only">Organisation</span>
        <select
          value={active.org.id}
          onChange={e => setActiveOrg(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-control border border-border-strong bg-surface px-2 text-sm font-medium text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {groupMemberships(memberships).map(g => (
            <optgroup key={g.kind} label={g.label}>
              {g.items.map(m => <option key={m.org.id} value={m.org.id}>{m.org.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  )
}
