import { FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui'
import type { GenerateKind } from '@/types/loadDocuments'
import { GENERATE_ACTIONS, canGenerate, type PanelRole } from './model'

/** Make the transport documents from the load. The logistic company only. */
export function GenerateButtons({ role, busyKind, onGenerate }: {
  role: PanelRole
  busyKind: GenerateKind | null
  onGenerate: (kind: GenerateKind) => void
}) {
  if (!canGenerate(role)) return null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Make documents">
      {GENERATE_ACTIONS.map(a => (
        <Button key={a.kind} size="sm" variant={a.kind === 'lr' ? 'primary' : 'secondary'} icon={<FilePlus2 size={14} />}
          loading={busyKind === a.kind} disabled={busyKind !== null && busyKind !== a.kind} onClick={() => onGenerate(a.kind)}>
          {a.label}
        </Button>
      ))}
    </div>
  )
}
