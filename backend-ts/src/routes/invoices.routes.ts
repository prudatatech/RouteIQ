/**
 * margixindia — One invoice: its document with links, and its PDF.
 *
 *   GET /invoices/payment-details[?invoice=id]  vendor, customer, admin: where to pay (bank, UPI, terms) the issuing company
 *   GET /invoices/:id      admin, superadmin: the invoice, seller, buyer, lines, GST split and links
 *   GET /invoices/:id/pdf  admin, superadmin, and the vendor or customer the invoice is billed to
 *
 * Listing, paying, voiding and pricing are staff actions under /finance. Managers run operations
 * only and have no access. A vendor or customer who asks for someone else's invoice gets a 404.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { buildInvoiceDetail, loadInvoiceFor } from '../services/invoice-detail.service';
import { getPaymentDetails } from '../services/company.service';
import { invoiceFileName, renderInvoicePdf } from '../services/invoice-pdf.service';

const router = Router();
router.use(requireAuth);

router.get('/payment-details', requireRole('admin', 'vendor', 'customer'), async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    // ?invoice=<id>: the bank details of the company that issued that invoice (the caller must be allowed
    // to see it); without it, the active company's, else the platform default
    const invoiceId = typeof req.query.invoice === 'string' ? req.query.invoice : '';
    if (invoiceId) {
      if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw new HttpError(404, 'Invoice not found');
      const inv = await loadInvoiceFor(invoiceId, req.user!);
      res.json(await getPaymentDetails(inv.issuer_org_id ?? undefined));
      return;
    }
    res.json(await getPaymentDetails());
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    res.json(await buildInvoiceDetail(await loadInvoiceFor(req.params.id, req.user!)));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/:id/pdf', requireRole('admin', 'vendor', 'customer'), async (req: Request, res: Response) => {
  try {
    const inv = await loadInvoiceFor(req.params.id, req.user!);
    // A void invoice is no longer a document to pay against; only staff may still print it
    if (inv.status === 'void' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') throw new HttpError(404, 'Invoice not found');
    const detail = await buildInvoiceDetail(inv);
    const pdf = await renderInvoicePdf(detail);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceFileName(detail)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
