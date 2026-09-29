import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import { peopleAPI } from '@/services/api'
import { Button, Card, CardHeader, Checkbox, EmptyState, Input, Modal, StatusPill, useConfirm } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { toE164, type EmergencyContact, type PersonDetail } from './types'

export function ContactsTab({ detail }: { detail: PersonDetail }) {
  const { user, emergency_contacts } = detail
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [editing, setEditing] = useState<EmergencyContact | 'new' | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['people'] })

  const remove = useMutation({
    mutationFn: (c: EmergencyContact) => peopleAPI.deleteEmergencyContact(user.id, c.id),
    onSuccess: () => { toast.success('Contact removed'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not remove this contact. Try again.')),
  })
  const askRemove = async (c: EmergencyContact) => {
    const ok = await confirm({ title: `Remove ${c.name}?`, message: 'They will no longer be listed as an emergency contact.', confirmLabel: 'Remove contact', tone: 'danger' })
    if (ok) remove.mutate(c)
  }

  return (
    <Card>
      <CardHeader
        title="Emergency contacts"
        description="Who to call if something goes wrong. Drivers see these in the driver app."
        actions={<Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Add contact</Button>}
      />
      {emergency_contacts.length === 0 ? (
        <EmptyState compact title="No emergency contacts yet" description="Add at least one, ideally a family member." action={<Button onClick={() => setEditing('new')}>Add contact</Button>} />
      ) : (
        <ul className="divide-y divide-border">
          {emergency_contacts.map(c => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{c.name} {c.is_primary && <StatusPill tone="brand" dot={false} className="ml-1">Primary</StatusPill>}</p>
                <p className="text-xs text-muted">{c.relation || 'Relation not set'} · <a className="text-brand hover:underline" href={`tel:${c.phone}`}><Phone size={12} className="mr-0.5 inline" aria-hidden="true" />{c.phone}</a></p>
              </div>
              <Button variant="secondary" size="sm" icon={<Pencil size={16} />} onClick={() => setEditing(c)}>Edit</Button>
              <Button variant="ghost" size="sm" icon={<Trash2 size={16} />} onClick={() => askRemove(c)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ContactModal personId={user.id} contact={editing === 'new' ? null : editing} first={emergency_contacts.length === 0} onClose={() => setEditing(null)} onDone={refresh} />}
    </Card>
  )
}

function ContactModal({ personId, contact, first, onClose, onDone }: {
  personId: string; contact: EmergencyContact | null; first: boolean; onClose: () => void; onDone: () => void
}) {
  const [name, setName] = useState(contact?.name ?? '')
  const [relation, setRelation] = useState(contact?.relation ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [primary, setPrimary] = useState(contact?.is_primary ?? first)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: () => {
      const data = { name: name.trim(), relation: relation.trim() || null, phone: toE164(phone)!, is_primary: primary }
      return contact ? peopleAPI.updateEmergencyContact(personId, contact.id, data) : peopleAPI.addEmergencyContact(personId, data)
    },
    onSuccess: () => { toast.success(contact ? 'Contact saved' : 'Contact added'); onDone(); onClose() },
    onError: err => toast.error(errorMessage(err, 'We could not save the contact. Try again.')),
  })

  const submit = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Enter a name.'
    if (!toE164(phone)) e.phone = 'Enter a 10-digit mobile number.'
    setErrors(e)
    if (Object.keys(e).length === 0) save.mutate()
  }

  return (
    <Modal
      open onClose={onClose} title={contact ? 'Edit contact' : 'Add contact'} closeOnBackdrop={!save.isPending} onSubmit={submit}
      footer={<><Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button type="submit" loading={save.isPending}>Save contact</Button></>}
    >
      <div className="space-y-4">
        <Input label="Name" required value={name} onChange={e => setName(e.target.value)} error={errors.name} data-autofocus />
        <Input label="Relation" value={relation} onChange={e => setRelation(e.target.value)} hint="For example spouse, father, brother." />
        <Input label="Mobile number" required type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} error={errors.phone} />
        <Checkbox label="Primary contact" description="Called first. Setting this makes any other contact non-primary." checked={primary} onChange={e => setPrimary(e.target.checked)} />
      </div>
    </Modal>
  )
}
