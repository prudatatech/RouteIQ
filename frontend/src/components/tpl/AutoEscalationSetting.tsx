import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { tplNetworkAPI } from '@/services/api'
import { Card, CardBody, CardHeader, Checkbox, Skeleton } from '@/components/ui'
import { errorMessage } from '@/utils/display'

/** Superadmin switch: let the matcher offer hard-to-fill loads to 3PL partners by itself. */
export function AutoEscalationSetting() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['tpl-network', 'settings'], queryFn: () => tplNetworkAPI.settings() })
  const save = useMutation({
    mutationFn: (value: boolean) => tplNetworkAPI.saveSettings(value),
    onSuccess: data => {
      queryClient.setQueryData(['tpl-network', 'settings'], data)
      toast.success(data.auto_escalate ? 'Automatic 3PL offers turned on' : 'Automatic 3PL offers turned off')
    },
    onError: err => toast.error(errorMessage(err, 'We could not save this setting. Try again.')),
  })

  return (
    <Card>
      <CardHeader
        title="3PL partners"
        description="Staff can always offer a load to partners by hand from Vendor loads or a shipment."
      />
      <CardBody>
        {settings.isLoading ? <Skeleton className="h-10 w-full" /> : (
          <Checkbox
            label="Offer hard-to-fill loads to 3PL partners automatically"
            description="When no own vehicle or vendor is a good match, partners whose corridor covers the route get an offer."
            checked={settings.data?.auto_escalate ?? false}
            disabled={save.isPending || settings.isError}
            onChange={e => save.mutate(e.target.checked)}
          />
        )}
      </CardBody>
    </Card>
  )
}
