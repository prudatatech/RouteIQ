import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { manifestTrackingId } from '@/components/shipments/format'
import { ErrorState, Skeleton } from '@/components/ui'
import ConsignmentCargo from './ConsignmentCargo'

/**
 * Cargo custody for a vendor's posted load. Assigning a vehicle adds the load to a cargo manifest
 * (`cargo_manifest.vendor_request_id`); the custody panel works on that manifest (CM-…).
 */
export default function VendorLoadCargo({ requestId }: { requestId: string }) {
  const manifest = useQuery({
    queryKey: ['cargo', 'manifest-of-request', requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cargo_manifest')
        .select('id')
        .eq('vendor_request_id', requestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as { id: string } | null) ?? null
    },
  })

  if (manifest.isLoading) return <Skeleton className="h-40 w-full" />
  if (manifest.isError) return <ErrorState compact title="We could not load this load’s cargo record" onRetry={() => manifest.refetch()} />
  // Not on a manifest yet (a 3PL partner carries it, or it is not assigned): nothing to track here
  if (!manifest.data) return null
  return <ConsignmentCargo code={manifestTrackingId(manifest.data.id)} cargoRef={{ manifest_id: manifest.data.id }} />
}
