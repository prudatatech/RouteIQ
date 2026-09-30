import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import type { ResolvedPlace } from '@/services/geocoding'
import { Alert, Button, Modal, PlaceSearch } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { returnTripKeys } from './data'

export interface MissingLocation {
  vendorId: string
  vendorName: string
  /** The bid that could not be awarded, when the modal is shown after a failed award. */
  bidId?: string
  /** True when the award just failed, which is when the backend tells the vendor to add a location. */
  vendorAsked: boolean
}

/**
 * A vendor with no pickup location can't be awarded space: the truck has nowhere to go.
 * Staff who know where the vendor is can set it for them; otherwise the vendor adds it themselves.
 */
export default function VendorLocationModal({ missing, onClose, onApprove }: {
  missing: MissingLocation | null
  onClose: () => void
  /** Approve the bid again once the location is set. */
  onApprove: (bidId: string) => void
}) {
  const queryClient = useQueryClient()
  const [place, setPlace] = useState<ResolvedPlace | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPlace(null)
    setSaved(false)
  }, [missing?.vendorId, missing?.bidId])

  const save = useMutation({
    mutationFn: () => vendorAPI.setLocation(missing!.vendorId, {
      lat: place!.lat,
      lng: place!.lng,
      ...(place!.parts?.city ? { city: place!.parts.city } : {}),
    }),
    onSuccess: () => {
      setSaved(true)
      toast.success('Location saved')
      queryClient.invalidateQueries({ queryKey: returnTripKeys.board })
    },
    onError: err => toast.error(errorMessage(err, 'We could not save the location. Try again.')),
  })

  return (
    <Modal
      open={!!missing}
      onClose={onClose}
      title="This vendor has no pickup location"
      description={missing ? `${missing.vendorName} has not said where the truck should collect the load.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{saved ? 'Close' : 'Not now'}</Button>
          {saved && missing?.bidId
            ? <Button icon={<Check size={16} />} onClick={() => { onApprove(missing.bidId!); onClose() }}>Approve bid now</Button>
            : <Button disabled={!place} loading={save.isPending} onClick={() => save.mutate()}>Save location</Button>}
        </>
      }
    >
      {missing && (
        <div className="space-y-4">
          {missing.vendorAsked && (
            <Alert tone="warning" title="The bid was not approved">
              The truck can’t be routed to a vendor with no pickup location. Vendor has been asked to add a location.
            </Alert>
          )}
          {saved ? (
            <Alert tone="success" title="Location saved">
              {missing.bidId ? 'You can approve the bid now.' : 'Their next bid can be approved.'}
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted">
                If you know where {missing.vendorName} loads from, set it for them. Their company details and KYC do not change.
              </p>
              <PlaceSearch
                label="Pickup location"
                required
                value={place}
                onChange={setPlace}
                hint="Choose a suggestion so the place has coordinates."
              />
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
