import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { vehiclePhotosAPI, type VehiclePhoto } from '@/services/api'
import { Card, CardBody, CardHeader, ErrorState, Skeleton, useConfirm } from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { errorMessage } from '@/utils/display'
import PhotoSlotTile from './PhotoSlotTile'
import { PHOTO_SLOTS, photoKeys, uploadVehiclePhoto, type PhotoSlot } from './photos'

/**
 * The photos of one vehicle: front, side, back and, optionally, interior and cargo
 * area. All are optional. Each one can be added, replaced or removed at any time.
 */
export function VehiclePhotoCard({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)

  const { data: photos, isLoading, error, refetch } = useQuery<VehiclePhoto[]>({
    queryKey: photoKeys.list(vehicleId),
    queryFn: () => vehiclePhotosAPI.list(vehicleId),
    // The links are signed for 10 minutes
    staleTime: 5 * 60_000,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: photoKeys.list(vehicleId) })
    queryClient.invalidateQueries({ queryKey: ['vehicle-requests'] })
  }

  const upload = useMutation({
    mutationFn: ({ slot, file }: { slot: PhotoSlot; file: File }) => uploadVehiclePhoto(vehicleId, slot, file),
    onSuccess: () => { toast.success('Photo saved'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not save the photo. Try again.')),
  })

  const remove = useMutation({
    mutationFn: (slot: PhotoSlot) => vehiclePhotosAPI.remove(vehicleId, slot),
    onSuccess: () => { toast.success('Photo removed'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not remove the photo. Try again.')),
  })

  const askRemove = async (slot: PhotoSlot, label: string) => {
    const ok = await confirm({ title: `Remove the ${label.toLowerCase()} photo?`, message: 'You can add another one any time.', confirmLabel: 'Remove photo', tone: 'danger' })
    if (ok) remove.mutate(slot)
  }

  const bySlot = new Map((photos ?? []).map(p => [p.slot, p]))

  return (
    <Card>
      <CardHeader title="Photos" description="Optional. Add or replace them any time." />
      <CardBody>
        {error ? (
          <ErrorState compact title="We could not load the photos" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"><Skeleton className="aspect-[4/3]" /><Skeleton className="aspect-[4/3]" /><Skeleton className="aspect-[4/3]" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {PHOTO_SLOTS.map(({ slot, label, hint }) => {
              const url = bySlot.get(slot)?.url ?? null
              return (
                <PhotoSlotTile
                  key={slot}
                  label={label}
                  hint={hint}
                  src={url}
                  busy={(upload.isPending && upload.variables?.slot === slot) || (remove.isPending && remove.variables === slot)}
                  onFile={file => upload.mutate({ slot, file })}
                  onRemove={() => askRemove(slot, label)}
                  onOpen={() => url && setViewing({ url, name: `${label} photo` })}
                />
              )
            })}
          </div>
        )}
      </CardBody>
      {viewing && <DocumentViewerModal isOpen onClose={() => setViewing(null)} fileUrl={viewing.url} fileName={viewing.name} />}
    </Card>
  )
}

export default VehiclePhotoCard
