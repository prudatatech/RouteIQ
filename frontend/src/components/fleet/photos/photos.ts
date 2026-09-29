import { vehiclePhotosAPI, type VehiclePhoto } from '@/services/api'
import { supabase } from '@/services/supabase'
import { errorMessage } from '@/utils/display'

export type PhotoSlot = VehiclePhoto['slot']

/** The photos a vehicle can have. All are optional; front is the one shown as the thumbnail. */
export const PHOTO_SLOTS: { slot: PhotoSlot; label: string; hint: string }[] = [
  { slot: 'front', label: 'Front', hint: 'Shows the plate' },
  { slot: 'side', label: 'Side', hint: 'The whole vehicle' },
  { slot: 'back', label: 'Back', hint: 'Rear doors and plate' },
  { slot: 'interior', label: 'Interior', hint: 'Cabin, optional' },
  { slot: 'cargo', label: 'Cargo area', hint: 'Load space, optional' },
]

export const photoKeys = { list: (vehicleId: string) => ['vehicle-photos', vehicleId] as const }

/** Same limit as the server (VEHICLE_PHOTO_MAX_BYTES). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
const MAX_EDGE = 1600
const ACCEPTED = ['image/jpeg', 'image/png']

/**
 * Shrinks a phone photo to a JPEG that fits the upload limit. A file the browser
 * cannot decode (or that is not JPG or PNG) is refused with a message.
 */
export async function preparePhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPG or PNG).')
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (blob && blob.size <= PHOTO_MAX_BYTES) return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  } catch {
    // Fall through: send the original when it is already allowed
  }
  if (ACCEPTED.includes(file.type) && file.size <= PHOTO_MAX_BYTES) return file
  throw new Error('Use a JPG or PNG photo under 5 MB.')
}

/** Uploads one photo through a signed URL from the backend and records it for the vehicle. */
export async function uploadVehiclePhoto(vehicleId: string, slot: PhotoSlot, original: File): Promise<VehiclePhoto> {
  const file = await preparePhoto(original)
  let upload
  try {
    upload = await vehiclePhotosAPI.uploadUrl(vehicleId, { slot, content_type: file.type, size: file.size })
  } catch (err) {
    throw new Error(errorMessage(err, 'We could not start the upload. Try again.'))
  }
  const { error } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('We could not upload the photo. Try again.')
  try {
    return await vehiclePhotosAPI.save(vehicleId, slot, upload.path)
  } catch (err) {
    throw new Error(errorMessage(err, 'We could not save the photo. Try again.'))
  }
}

/** Uploads the photos picked before the vehicle existed. Returns the slots that failed. */
export async function uploadStagedPhotos(vehicleId: string, staged: Partial<Record<PhotoSlot, File>>): Promise<PhotoSlot[]> {
  const failed: PhotoSlot[] = []
  for (const { slot } of PHOTO_SLOTS) {
    const file = staged[slot]
    if (!file) continue
    try {
      await uploadVehiclePhoto(vehicleId, slot, file)
    } catch {
      failed.push(slot)
    }
  }
  return failed
}
