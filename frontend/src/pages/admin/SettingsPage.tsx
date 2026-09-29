import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { financeAPI } from '@/services/api'
import { Button, Card, CardBody, CardHeader, DetailList, ErrorState, Input, Page, PageHeader, Skeleton } from '@/components/ui'
import { errorMessage, formatRupees } from '@/utils/display'

/** Numbers the fleet's costs are worked out from. */
export default function SettingsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['finance', 'settings'], queryFn: () => financeAPI.settings() })
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (settings.data) setPrice(settings.data.fuel_price_per_litre != null ? String(settings.data.fuel_price_per_litre) : '')
  }, [settings.data])

  const save = useMutation({
    mutationFn: (value: number) => financeAPI.saveFuelPrice(value),
    onSuccess: data => {
      toast.success('Fuel price saved')
      queryClient.setQueryData(['finance', 'settings'], data)
      queryClient.invalidateQueries({ queryKey: ['finance', 'summary'] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not save the fuel price. Try again.')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = Number(price)
    if (!price || !Number.isFinite(value) || value <= 0 || value > 1000) {
      setError('Enter a price per litre greater than zero')
      return
    }
    setError(undefined)
    save.mutate(value)
  }

  const current = settings.data?.fuel_price_per_litre ?? null
  const unchanged = current != null && Number(price) === current

  return (
    <Page>
      <PageHeader title="Settings" description="Values that profit and loss and pricing are worked out from." />

      {settings.isError ? (
        <ErrorState title="We could not load settings" description="Check your connection and try again." onRetry={() => settings.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Fuel price" description="Used to estimate fuel cost on completed routes that have no fuel expense recorded." />
            <CardBody>
              {settings.isLoading ? <Skeleton className="h-16 w-full" /> : (
                <form onSubmit={submit} noValidate className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <Input
                    label="Price per litre"
                    className="sm:w-56"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    leading="₹"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    error={error}
                    hint={current == null ? 'Not set yet. Fuel is left out of costs until you set it.' : undefined}
                  />
                  <Button type="submit" loading={save.isPending} disabled={unchanged}>Save fuel price</Button>
                </form>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Rate card" description="Read only here." />
            <CardBody>
              {settings.isLoading ? <Skeleton className="h-10 w-full" /> : (
                <DetailList
                  columns={1}
                  items={[{ label: 'Rate per km', value: settings.data?.rate_per_km != null ? formatRupees(settings.data.rate_per_km) : 'Not set' }]}
                />
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </Page>
  )
}
