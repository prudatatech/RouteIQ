/**
 * margixindia — Shipment documents, dispatch checklist, trip settlement and timeline of a vendor load.
 * Mounted at /api/v1/loads. `:id` is the vendor load (vendor_shipment_requests).
 *
 *   GET   /:id/documents                       the load's documents
 *   POST  /:id/documents/upload-url            signed upload URL for one file (PUT the file to upload_url)
 *   POST  /:id/documents                       record a document (metadata, optionally an uploaded file_path)
 *   PATCH /:id/documents/:docId                change a document (a new version, with its history)
 *   POST  /:id/documents/generate/:kind        carrier: generate lr, freight_sheet, pod, loading_report,
 *                                              unloading_report, damage_report or trip_closure
 *   GET   /:id/documents/:docId/pdf            the generated PDF (stream), or { url } for an uploaded file
 *   GET   /:id/documents/:docId/history        who changed what, when
 *   GET   /:id/dispatch-check                  the pre-dispatch checklist with flags
 *   GET   /:id/settlement                      the trip settlement (404 when none is opened)
 *   POST  /:id/settlement                      carrier: open, or update freight / advance / terms
 *   POST  /:id/settlement/extra-charges        carrier: add an extra charge (not counted until approved)
 *   POST  /:id/settlement/extra-charges/:idx/approve   carrier: approve it
 *   POST  /:id/settlement/deductions           carrier: add a deduction
 *   POST  /:id/settlement/close                carrier: close the trip (needs a final POD)
 *   GET   /:id/timeline                        load status, documents, custody, exceptions and settlement, oldest first
 *
 * Who: the vendor organisation of the load, the logistic company carrying it, and platform admins (read only).
 * Anyone else gets a 404. Generating, settlement changes and closing are the carrier's alone.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { sendError, HttpError } from '../core/errors';
import { idempotent } from '../core/idempotency';
import { loadCode, requireCarrier, resolveLoadAccess } from '../services/documents/context';
import {
  createDocument, createDocumentUploadUrl, documentHistory, getDocument, listDocuments, signedFileUrl, updateDocument,
} from '../services/documents/documents.service';
import { generateDocument } from '../services/documents/generate';
import { renderDocumentPdf, documentFileName } from '../services/documents/pdf';
import { isGeneratedKind } from '../services/documents/kinds';
import { dispatchCheck } from '../services/documents/checklist';
import {
  addDeduction, addExtraCharge, approveExtraCharge, getSettlement, upsertSettlement,
} from '../services/documents/settlement';
import { closeSettlement } from '../services/documents/close';
import { loadTimeline } from '../services/documents/timeline';

const router = Router();
router.use(requireAuth);
router.use(requireRole('admin', 'manager', 'vendor'));

type Handler = (req: Request, res: Response) => Promise<void>;
const handle = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    await fn(req, res);
  } catch (e) {
    sendError(req, res, e);
  }
};

router.get('/:id/documents', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.json({
    load: { id: access.load.id, code: loadCode(access.load), status: access.load.status, viewer: access.viewer, vendor_org_id: access.vendorOrgId, carrier_org_id: access.carrierOrgId },
    documents: await listDocuments(access),
  });
}));

router.post('/:id/documents/upload-url', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.json(await createDocumentUploadUrl(access, req.body));
}));

router.post('/:id/documents/generate/:kind', idempotent('load-document-generate'), handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.status(201).json(await generateDocument(access, req.params.kind, req.body));
}));

router.post('/:id/documents', idempotent('load-document-create'), handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.status(201).json(await createDocument(access, req.body));
}));

router.patch('/:id/documents/:docId', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.json(await updateDocument(access, req.params.docId, req.body));
}));

router.get('/:id/documents/:docId/pdf', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  const doc = await getDocument(access, req.params.docId);
  // An uploaded file is shown through a short-lived signed link
  if (doc.file_path) {
    const url = await signedFileUrl(doc.file_path);
    if (!url) throw new HttpError(404, 'The file is not available');
    res.json({ url, expires_in: 600 });
    return;
  }
  if (!isGeneratedKind(doc.kind)) throw new HttpError(404, 'This document has no file or PDF');
  const pdf = await renderDocumentPdf(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${documentFileName(doc)}"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.end(pdf);
}));

router.get('/:id/documents/:docId/history', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  const events = await documentHistory(access, req.params.docId);
  res.json({ document_id: req.params.docId, events });
}));

router.get('/:id/dispatch-check', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.json(await dispatchCheck(access, await listDocuments(access)));
}));

router.get('/:id/settlement', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.json(await getSettlement(access));
}));

router.post('/:id/settlement', idempotent('load-settlement'), handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  requireCarrier(access);
  res.json(await upsertSettlement(access, req.body));
}));

router.post('/:id/settlement/extra-charges', idempotent('load-settlement-extra'), handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  requireCarrier(access);
  res.status(201).json(await addExtraCharge(access, req.body));
}));

router.post('/:id/settlement/extra-charges/:idx/approve', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  requireCarrier(access);
  res.json(await approveExtraCharge(access, req.params.idx));
}));

router.post('/:id/settlement/deductions', idempotent('load-settlement-deduction'), handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  requireCarrier(access);
  res.status(201).json(await addDeduction(access, req.body));
}));

router.post('/:id/settlement/close', idempotent('load-settlement-close'), handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  requireCarrier(access);
  res.json(await closeSettlement(access, req.body));
}));

router.get('/:id/timeline', handle(async (req, res) => {
  const access = await resolveLoadAccess(req, req.params.id);
  res.json({ load_id: access.load.id, entries: await loadTimeline(access) });
}));

export default router;
