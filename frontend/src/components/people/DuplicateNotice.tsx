import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui'
import { personName, roleLabel, type DuplicateMatch } from './types'

/** "Already on file" warning with a link to the existing person. */
export function DuplicateNotice({ matches, what, onNavigate }: { matches: DuplicateMatch[]; what: string; onNavigate?: () => void }) {
  if (matches.length === 0) return null
  return (
    <Alert tone="danger" title={`This ${what} is already on file`}>
      <ul className="space-y-1">
        {matches.map(m => (
          <li key={m.id}>
            <Link to={`/admin/users/${m.id}`} onClick={onNavigate} className="font-medium text-brand hover:underline">
              {personName({ full_name: m.full_name })}
            </Link>
            {m.role ? ` · ${roleLabel(m.role)}` : ''}. Open their profile instead of adding a second record.
          </li>
        ))}
      </ul>
    </Alert>
  )
}
