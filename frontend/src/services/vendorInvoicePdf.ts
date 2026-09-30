import { api } from '@/services/api'

/**
 * Downloads an invoice as a PDF. `GET /invoices/:id/pdf` needs the sign-in header, so the file is
 * fetched with it and handed to the browser as a download instead of being linked to directly.
 */
export async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<void> {
  const res = await api.get(`/invoices/${encodeURIComponent(invoiceId)}/pdf`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `${invoiceNumber || 'invoice'}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    // The browser has started the download by the time the click returns
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
