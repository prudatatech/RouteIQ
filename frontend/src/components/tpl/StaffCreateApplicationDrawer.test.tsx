// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ adminCreate: vi.fn() }))
vi.mock('@/services/api', () => ({
  tplAPI: { adminCreate: api.adminCreate },
  bankAPI: { ifsc: vi.fn() },
}))

const docs = vi.hoisted(() => ({ uploadTplDocument: vi.fn() }))
vi.mock('@/services/tplDocuments', () => ({ uploadTplDocument: docs.uploadTplDocument }))
vi.mock('@/services/kycDocuments', () => ({ getKycDocumentUrl: vi.fn().mockResolvedValue('https://signed/doc.pdf') }))
vi.mock('@/services/supabase', () => ({ supabase: { auth: {}, storage: { from: vi.fn() } } }))

import { TPL_DOCUMENT_TYPES } from './constants'
import { StaffCreateApplicationDrawer } from './StaffCreateApplicationDrawer'

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/^Company name/), { target: { value: 'Acme Logistics' } })
  fireEvent.change(screen.getByLabelText(/^Contact person/), { target: { value: 'Priya Rao' } })
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'ops@acme.example' } })
  fireEvent.change(screen.getByLabelText(/^PAN/), { target: { value: 'ABCDE1234F' } })
  fireEvent.change(screen.getByLabelText(/^Entity type/), { target: { value: 'Proprietorship' } })
  fireEvent.change(screen.getByLabelText(/^Authorized signatory name/), { target: { value: 'Priya Rao' } })
}

beforeEach(() => {
  api.adminCreate.mockReset()
  docs.uploadTplDocument.mockReset()
})

afterEach(cleanup)

describe('StaffCreateApplicationDrawer', () => {
  it('renders the full application form when open', () => {
    render(<StaffCreateApplicationDrawer open onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText('Enter an application for someone')).toBeTruthy()
    expect(screen.getByLabelText(/^Company name/)).toBeTruthy()
    expect(screen.getByLabelText(/^PAN/)).toBeTruthy()
    expect(screen.getByText('PAN Card')).toBeTruthy()
    expect(screen.getByText('GST Certificate')).toBeTruthy()
  })

  it('renders nothing (no dialog) when closed', () => {
    render(<StaffCreateApplicationDrawer open={false} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.queryByText('Enter an application for someone')).toBeNull()
  })

  it('uploads a document, creates the application without fleetSize or user_id, and shows the success state', async () => {
    docs.uploadTplDocument.mockResolvedValue('applications/acme_logistics_0001/pan_card_xyz.pdf')
    api.adminCreate.mockResolvedValue({ success: true, data: { id: 'p1', custom_id: 'acme_logistics_0001', status: 'pending' } })
    const onCreated = vi.fn()

    render(<StaffCreateApplicationDrawer open onClose={vi.fn()} onCreated={onCreated} />)

    fillRequiredFields()

    // The 3PL ID is auto-suggested from the company name once it is typed.
    const customIdInput = screen.getByLabelText('3PL ID') as HTMLInputElement
    expect(customIdInput.value).toMatch(/^acme_logistics_\d{4}$/)

    // Documents render in TPL_DOCUMENT_TYPES order; the first slot is "PAN Card".
    // The drawer portals into document.body, outside the render() container.
    const fileInputs = document.body.querySelectorAll('input[type="file"]')
    expect(fileInputs.length).toBe(TPL_DOCUMENT_TYPES.length)
    const file = new File(['dummy'], 'pan.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInputs[0], { target: { files: [file] } })

    await waitFor(() => expect(docs.uploadTplDocument).toHaveBeenCalledTimes(1))
    const [, docType, target] = docs.uploadTplDocument.mock.calls[0]
    expect(docType).toBe('PAN Card')
    expect(target).toEqual({ customId: customIdInput.value })

    // Once uploaded, the document slot shows a "View" action instead of "Upload".
    await waitFor(() => expect(screen.getByText('View')).toBeTruthy())

    fireEvent.click(screen.getByText('Create application'))

    await waitFor(() => expect(api.adminCreate).toHaveBeenCalledTimes(1))
    const payload = api.adminCreate.mock.calls[0][0]
    expect(payload).toMatchObject({
      companyName: 'Acme Logistics',
      contactName: 'Priya Rao',
      email: 'ops@acme.example',
      pan: 'ABCDE1234F',
      entityType: 'Proprietorship',
      authorizedSignatoryName: 'Priya Rao',
      msmeStatus: 'Not Registered',
      slaCommitment: '2 Hours',
      taxTreatment: '12% GTA (With ITC) - Forward Charge',
      documents: [{ type: 'PAN Card', url: 'applications/acme_logistics_0001/pan_card_xyz.pdf' }],
    })
    expect(payload).not.toHaveProperty('fleetSize')
    expect(payload).not.toHaveProperty('user_id')
    expect(payload).not.toHaveProperty('truckType')
    expect(payload).not.toHaveProperty('operatingFrom')

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Application created')).toBeTruthy()
    expect(screen.getByText('acme_logistics_0001')).toBeTruthy()
    expect(screen.getByText(/pending review/)).toBeTruthy()
  })

  it('refuses to submit when a required field is missing', async () => {
    api.adminCreate.mockResolvedValue({ success: true, data: { id: 'p1', custom_id: null } })
    render(<StaffCreateApplicationDrawer open onClose={vi.fn()} onCreated={vi.fn()} />)

    fireEvent.click(screen.getByText('Create application'))

    expect(await screen.findByText('Fix the highlighted fields before creating this application')).toBeTruthy()
    expect(api.adminCreate).not.toHaveBeenCalled()
  })
})
