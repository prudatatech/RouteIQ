import { useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import PhotoSlotTile from './PhotoSlotTile'
import { PHOTO_SLOTS, preparePhoto, type PhotoSlot } from './photos'

export type StagedPhotoFiles = Partial<Record<PhotoSlot, File>>

/**
 * Photo picker for a vehicle that does not exist yet (the Add vehicle form). The
 * pictures are kept in the browser and uploaded once the vehicle is saved.
 */
export default function StagedPhotos({ files, onChange }: { files: StagedPhotoFiles; onChange: (next: StagedPhotoFiles) => void }) {
  const previews = useMemo(
    () => Object.fromEntries(Object.entries(files).map(([slot, file]) => [slot, URL.createObjectURL(file)])) as Record<string, string>,
    [files],
  )
  useEffect(() => () => { Object.values(previews).forEach(url => URL.revokeObjectURL(url)) }, [previews])

  const pick = async (slot: PhotoSlot, file: File) => {
    try {
      onChange({ ...files, [slot]: await preparePhoto(file) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We could not use that photo.')
    }
  }
  const drop = (slot: PhotoSlot) => {
    const next = { ...files }
    delete next[slot]
    onChange(next)
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {PHOTO_SLOTS.map(({ slot, label, hint }) => (
        <PhotoSlotTile key={slot} label={label} hint={hint} src={previews[slot] ?? null} onFile={file => pick(slot, file)} onRemove={() => drop(slot)} />
      ))}
    </div>
  )
}
