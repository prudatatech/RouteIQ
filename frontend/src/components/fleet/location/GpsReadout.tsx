import { useState } from 'react'
import { CheckCircle2, Copy, ExternalLink } from 'lucide-react'
import { DetailList, IconButton, StatusPill } from '@/components/ui'
import { formatRelative, formatDateTime } from '@/utils/display'
import { copyText } from './clipboard'
import { accuracyText, coordinatesText, googleMapsUrl, hasPosition, headingText, speedText, type VehicleLocation } from './format'

/** Coordinates, speed, heading, accuracy and last seen of one vehicle, with Open in Google Maps. */
export default function GpsReadout({ location, place, placeLoading, now = Date.now() }: {
  location: VehicleLocation
  place?: string | null
  placeLoading?: boolean
  now?: number
}) {
  const [copied, setCopied] = useState(false)
  const coords = coordinatesText(location.latitude, location.longitude)

  const copy = async () => {
    if (!coords) return
    if (await copyText(coords)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="space-y-3">
      <DetailList
        columns={1}
        items={[
          {
            label: 'Coordinates',
            value: coords
              ? (
                <span className="flex items-center gap-1">
                  <span className="whitespace-nowrap font-mono text-xs">{coords}</span>
                  <IconButton
                    label={copied ? 'Copied' : 'Copy coordinates'}
                    size="sm"
                    icon={copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
                    onClick={copy}
                  />
                </span>
              )
              : 'Unknown',
          },
          { label: 'Place', value: place || (placeLoading ? 'Looking up…' : 'Not available') },
        ]}
      />
      <DetailList
        columns={1}
        className="grid-cols-2"
        items={[
          { label: 'Speed', value: speedText(location.speed_kmph) },
          { label: 'Heading', value: headingText(location.heading) },
          { label: 'Accuracy', value: accuracyText(location.accuracy_m) },
          {
            label: 'Last seen',
            value: location.last_seen_at
              ? (
                <span title={formatDateTime(location.last_seen_at)}>
                  {formatRelative(location.last_seen_at, now)}{' '}
                  <StatusPill tone={location.live ? 'success' : 'neutral'} dot={false}>{location.live ? 'Live' : 'Not reporting'}</StatusPill>
                </span>
              )
              : 'Never',
          },
        ]}
      />
      {hasPosition(location.latitude, location.longitude) && (
        <a
          href={googleMapsUrl(location.latitude, location.longitude!)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <ExternalLink size={14} aria-hidden="true" />
          Open in Google Maps
        </a>
      )}
    </div>
  )
}
