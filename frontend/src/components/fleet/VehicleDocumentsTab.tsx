import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button, DataTable, StatusPill, type Column } from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { formatDate } from '@/utils/display'
import { expiryStatus } from '@/utils/documentExpiry'
import { vehicleDocuments, type DocRow } from './documents'
import type { Vehicle } from './types'

/** Valid, expiring soon, expired, or nothing on file: never colour alone. */
function ExpiryPill({ expiry }: { expiry: string | null }) {
  if (!expiry) return <StatusPill tone="neutral" dot={false}>No expiry on file</StatusPill>
  const status = expiryStatus(expiry)
  if (status) return <StatusPill tone={status.tone}>{status.label}</StatusPill>
  return <StatusPill tone="success">Valid</StatusPill>
}

/** RC, insurance, fitness, permit and PUC: number, expiry, and the uploaded file. */
export default function VehicleDocumentsTab({ vehicle }: { vehicle: Vehicle }) {
  const [viewing, setViewing] = useState<DocRow | null>(null)
  const rows = vehicleDocuments(vehicle)

  const columns: Column<DocRow>[] = [
    { key: 'name', header: 'Document', cell: r => <span className="font-medium text-text">{r.name}</span> },
    { key: 'number', header: 'Number', hideBelow: 'md', cell: r => <span className="font-mono text-sm">{r.number || '—'}</span> },
    { key: 'expiry', header: 'Expires', sortValue: r => r.expiry ?? '', cell: r => (r.expiry ? formatDate(r.expiry) : '—') },
    { key: 'status', header: 'Status', cell: r => <ExpiryPill expiry={r.expiry} /> },
    {
      key: 'file', header: 'File', align: 'right',
      cell: r => r.url
        ? <Button size="sm" variant="secondary" icon={<FileText size={14} />} onClick={() => setViewing(r)}>View</Button>
        : <span className="text-sm text-muted">Not uploaded</span>,
    },
  ]

  return (
    <>
      <DataTable
        caption={`Documents of ${vehicle.plate_number}`}
        columns={columns}
        rows={rows}
        rowKey={r => r.key}
        pageSize={10}
      />
      <DocumentViewerModal
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        fileUrl={viewing?.url ?? ''}
        fileName={viewing ? `${viewing.name} - ${vehicle.plate_number}` : ''}
      />
    </>
  )
}
