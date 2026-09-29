import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { dispatchAPI, financeAPI } from '@/services/api'
import { Button, Card, CardBody, CardHeader, DetailList, ErrorState, Input, Page, PageHeader, Skeleton } from '@/components/ui'
import { errorMessage, formatRupees } from '@/utils/display'

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/

/** The number drivers call from the driver app. */
function DispatchPhoneCard() {
  const queryClient = useQueryClient()
  const contact = useQuery({ queryKey: ['dispatch-contact'], queryFn: () => dispatchAPI.contact() })
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (contact.data) setPhone(contact.data.phone ?? '')
  }, [contact.data])

  const save = useMutation({
    mutationFn: (value: string | null) => dispatchAPI.saveContact(value),
    onSuccess: data => {
      toast.success(data.phone ? 'Dispatch phone saved' : 'Dispatch phone removed')
      queryClient.setQueryData(['dispatch-contact'], data)
    },
    onError: err => toast.error(errorMessage(err, 'We could not save the dispatch phone. Try again.')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const cleaned = phone.replace(/[\s\-().]/g, '')
    if (cleaned && !PHONE_PATTERN.test(cleaned)) {
      setError('Enter 7 to 15 digits, with an optional + at the start')
      return
    }
    setError(undefined)
    save.mutate(cleaned || null)
  }

  const current = contact.data?.phone ?? ''
  const unchanged = phone.replace(/[\s\-().]/g, '') === current

  return (
    <Card>
      <CardHeader title="Dispatch phone" description="Drivers call this number from the driver app: from More actions, and when dispatch rings them." />
      <CardBody>
        {contact.isLoading ? <Skeleton className="h-16 w-full" /> : contact.isError ? (
          <ErrorState compact title="We could not load the dispatch phone" onRetry={() => contact.refetch()} />
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Input
              label="Phone number"
              className="sm:w-64"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              error={error}
              hint={current ? undefined : 'Not set yet. Drivers see that no number is set.'}
            />
            <Button type="submit" loading={save.isPending} disabled={unchanged}>{phone.trim() ? 'Save phone' : 'Remove phone'}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  )
}

/** Numbers the fleet's costs are worked out from, and how drivers reach dispatch. */
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
      <PageHeader title="Settings" description="Values that profit and loss and pricing are worked out from, and the number drivers call." />

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

          <DispatchPhoneCard />

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
