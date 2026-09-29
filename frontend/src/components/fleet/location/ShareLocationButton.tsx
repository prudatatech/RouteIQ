import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, Share2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { Alert, Button, Input, Modal, Select } from '@/components/ui'
import { errorMessage, formatDateTime } from '@/utils/display'
import { SHARE_DURATIONS, shareUrl, type ShareLink } from './format'
import { copyText } from './clipboard'
import { locationKeys } from './useVehicleLocation'

/**
 * "Share live location": creates a link anyone can open, without signing in, to see this vehicle's
 * position and recent path until the link expires. Links still open can be stopped from here.
 */
export default function ShareLocationButton({ vehicleId, plate, disabled }: { vehicleId: string; plate: string; disabled?: boolean }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState('24')
  const [created, setCreated] = useState<ShareLink | null>(null)

  const links = useQuery<ShareLink[]>({
    queryKey: locationKeys.shares(vehicleId),
    queryFn: () => fleetAPI.shareLinks(vehicleId) as Promise<ShareLink[]>,
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () => fleetAPI.createShareLink(vehicleId, Number(hours)) as Promise<ShareLink>,
    onSuccess: async link => {
      setCreated(link)
      queryClient.invalidateQueries({ queryKey: locationKeys.shares(vehicleId) })
      if (link.path && await copyText(shareUrl(link.path, window.location.origin))) toast.success('Link copied')
    },
    onError: err => toast.error(errorMessage(err, 'We could not create the link. Try again.')),
  })

  const revoke = useMutation({
    mutationFn: (linkId: string) => fleetAPI.revokeShareLink(linkId),
    onSuccess: (_data, linkId) => {
      if (created?.id === linkId) setCreated(null)
      toast.success('Sharing stopped')
      queryClient.invalidateQueries({ queryKey: locationKeys.shares(vehicleId) })
    },
    onError: err => toast.error(errorMessage(err, 'We could not stop sharing. Try again.')),
  })

  const copyLink = async () => {
    if (!created?.path) return
    if (await copyText(shareUrl(created.path, window.location.origin))) toast.success('Link copied')
    else toast.error('Select the link and copy it')
  }

  const close = () => { setOpen(false); setCreated(null) }
  const createdUrl = created?.path ? shareUrl(created.path, window.location.origin) : null

  return (
    <>
      <Button variant="secondary" icon={<Share2 size={16} />} disabled={disabled} onClick={() => setOpen(true)}>
        Share live location
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Share live location"
        description={`Anyone with the link can see where ${plate} is now and where it has been in the last few hours. They cannot see its load, driver or customers.`}
        footer={<Button variant="secondary" onClick={close}>Done</Button>}
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select
              label="Link works for"
              className="sm:flex-1"
              value={hours}
              onChange={e => setHours(e.target.value)}
              options={SHARE_DURATIONS.map(d => ({ value: String(d.hours), label: d.label }))}
            />
            <Button icon={<Link2 size={16} />} loading={create.isPending} onClick={() => create.mutate()}>Create link</Button>
          </div>

          {createdUrl && (
            <div className="space-y-2">
              <Input label="Share this link" readOnly value={createdUrl} onFocus={e => e.currentTarget.select()} />
              <Button
                variant="secondary"
                size="sm"
                icon={<Copy size={14} />}
                onClick={copyLink}
              >
                Copy link
              </Button>
              <p className="text-xs text-muted">This link is shown once. Create a new one if you lose it.</p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-text">Links still open</p>
            {links.isError ? (
              <Alert tone="danger" title="We could not load the open links" className="mt-2" />
            ) : (links.data ?? []).length === 0 ? (
              <p className="mt-1 text-sm text-muted">{links.isLoading ? 'Loading…' : 'None. Create one above.'}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-control border border-border">
                {links.data!.map(link => (
                  <li key={link.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 text-text">
                      Until {formatDateTime(link.expires_at)}
                      <span className="block text-xs text-muted">
                        Opened {link.view_count.toLocaleString('en-IN')} {link.view_count === 1 ? 'time' : 'times'}
                      </span>
                    </span>
                    <Button variant="secondary" size="sm" loading={revoke.isPending && revoke.variables === link.id} onClick={() => revoke.mutate(link.id)}>
                      Stop sharing
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
