/**
 * margixindia — People routes: profiles of drivers and staff.
 * See docs/people-plan.md for the contract. `/people/me/...` is the signed-in
 * person's own record (the driver app uses it).
 */
import express, { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { idempotent } from '../core/idempotency';
import { STAFF_ROLES, isStaff } from '../core/ownership';
import { Actor, PERSON_ROLES, loadPerson } from '../services/people-common';
import * as people from '../services/people.service';
import * as documents from '../services/people-documents.service';
import * as bank from '../services/people-bank.service';
import * as io from '../services/people-io.service';
import { getPeopleSettings, savePeopleSettings } from '../services/people-settings.service';

const router = Router();

const handle = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    sendError(req, res, e);
  }
};

const actorOf = (req: Request): Actor => ({ user_id: req.user!.user_id, role: req.user!.role });
const idOf = (req: Request): string => req.params.id;
const subjectOf = (req: Request) => loadPerson(idOf(req));
const staffOnly = requireRole(...STAFF_ROLES);
const adminOnly = requireRole('admin');

/** Staff, or the person themselves. */
function selfOrStaff(req: Request, res: Response, next: NextFunction): void {
  if (isStaff(req.user) || req.user!.user_id === req.params.id) {
    next();
    return;
  }
  res.status(403).json({ detail: 'Not authorized for this action' });
}

router.use(requireAuth);

// /people/me/... is the signed-in person's own id
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.url === '/me' || req.url.startsWith('/me/') || req.url.startsWith('/me?')) {
    if (!(PERSON_ROLES as readonly string[]).includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized for this action' });
      return;
    }
    req.url = `/${req.user!.user_id}${req.url.slice(3)}`;
  }
  next();
});

const num = (v: unknown): number | undefined => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// ── Collection ─────────────────────────────────────────────

router.get('/', staffOnly, handle(async (req, res) => {
  res.json(await people.listPeople({
    role: str(req.query.role), status: str(req.query.status), q: str(req.query.q), docs: str(req.query.docs),
    limit: num(req.query.limit), offset: num(req.query.offset),
  }));
}));

router.post('/', adminOnly, handle(async (req, res) => {
  res.status(201).json(await people.createPerson(actorOf(req), req.body ?? {}));
}));

router.get('/duplicates', staffOnly, handle(async (req, res) => {
  res.json(await people.findDuplicates({ phone: req.query.phone, doc_type: req.query.doc_type, doc_number: req.query.doc_number, exclude: req.query.exclude }));
}));

router.get('/settings', staffOnly, handle(async (_req, res) => {
  res.json(await getPeopleSettings());
}));

router.put('/settings', adminOnly, handle(async (req, res) => {
  res.json(await savePeopleSettings(req.body ?? {}));
}));

router.post('/import', adminOnly, express.raw({ type: ['multipart/form-data', 'text/csv', 'text/plain'], limit: '2mb' }), handle(async (req, res) => {
  let csv: string;
  if (Buffer.isBuffer(req.body)) {
    const type = req.headers['content-type'] ?? '';
    csv = type.startsWith('multipart/form-data') ? io.extractMultipartFile(req.body, type) : req.body.toString('utf8');
  } else if (typeof req.body?.csv === 'string') {
    csv = req.body.csv;
  } else {
    throw new HttpError(400, 'Send the CSV as a file');
  }
  res.json(await io.importPeople(actorOf(req), csv, req.query.commit === 'true'));
}));

function sendCsv(res: Response, name: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(csv);
}

router.get('/export.csv', staffOnly, handle(async (_req, res) => {
  sendCsv(res, 'people.csv', await io.exportPeopleCsv());
}));

router.get('/documents/expiring.csv', staffOnly, handle(async (req, res) => {
  const days = num(req.query.days) ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'days must be a whole number from 1 to 365');
  sendCsv(res, 'expiring-documents.csv', await io.expiringDocumentsCsv(days));
}));

// ── One person ─────────────────────────────────────────────

router.get('/:id', selfOrStaff, handle(async (req, res) => {
  res.json(await people.getPersonDetail(actorOf(req), idOf(req)));
}));

router.patch('/:id', adminOnly, handle(async (req, res) => {
  res.json(await people.updatePerson(actorOf(req), idOf(req), req.body ?? {}));
}));

router.post('/:id/status', adminOnly, handle(async (req, res) => {
  res.json(await people.changeStatus(actorOf(req), idOf(req), req.body ?? {}));
}));

router.post('/:id/invite', adminOnly, handle(async (req, res) => {
  res.json(await people.sendInvite(actorOf(req), idOf(req)));
}));

router.post('/:id/anonymise', requireRole('superadmin'), handle(async (req, res) => {
  res.json(await people.anonymisePerson(actorOf(req), idOf(req)));
}));

router.post('/:id/consent', selfOrStaff, handle(async (req, res) => {
  res.json(await people.recordConsent(actorOf(req), idOf(req), req.body ?? {}));
}));

// ── Documents ──────────────────────────────────────────────

router.get('/:id/documents', selfOrStaff, handle(async (req, res) => {
  res.json(await documents.listDocuments(await subjectOf(req)));
}));

router.post('/:id/documents/upload-url', selfOrStaff, handle(async (req, res) => {
  res.json(await documents.createUploadUrl(await subjectOf(req), req.body ?? {}));
}));

router.post('/:id/documents', selfOrStaff, idempotent('people-document'), handle(async (req, res) => {
  res.status(201).json(await documents.createDocument(actorOf(req), await subjectOf(req), req.body ?? {}));
}));

router.patch('/:id/documents/:docId', staffOnly, handle(async (req, res) => {
  res.json(await documents.updateDocument(actorOf(req), await subjectOf(req), req.params.docId, req.body ?? {}));
}));

router.get('/:id/documents/:docId/file', selfOrStaff, handle(async (req, res) => {
  const index = req.query.index === undefined ? undefined : Number(req.query.index);
  res.json(await documents.getDocumentFile(actorOf(req), await subjectOf(req), req.params.docId, index));
}));

router.delete('/:id/documents/:docId', adminOnly, handle(async (req, res) => {
  await documents.archiveDocument(actorOf(req), await subjectOf(req), req.params.docId);
  res.status(204).end();
}));

// ── Emergency contacts (the person can read their own) ─────

router.get('/:id/emergency-contacts', selfOrStaff, handle(async (req, res) => {
  res.json(await bank.listContacts((await subjectOf(req)).id));
}));

router.post('/:id/emergency-contacts', staffOnly, handle(async (req, res) => {
  res.status(201).json(await bank.createContact(actorOf(req), await subjectOf(req), req.body ?? {}));
}));

router.patch('/:id/emergency-contacts/:contactId', staffOnly, handle(async (req, res) => {
  res.json(await bank.updateContact(actorOf(req), await subjectOf(req), req.params.contactId, req.body ?? {}));
}));

router.delete('/:id/emergency-contacts/:contactId', staffOnly, handle(async (req, res) => {
  await bank.deleteContact(actorOf(req), await subjectOf(req), req.params.contactId);
  res.status(204).end();
}));

// ── Bank and payout (admins only) ──────────────────────────

router.get('/:id/bank-accounts', adminOnly, handle(async (req, res) => {
  const subject = await subjectOf(req);
  await bank.assertBankAccess(actorOf(req), subject);
  res.json(await bank.listBankAccounts(subject));
}));

router.post('/:id/bank-accounts', adminOnly, handle(async (req, res) => {
  res.status(201).json(await bank.createBankAccount(actorOf(req), await subjectOf(req), req.body ?? {}));
}));

router.patch('/:id/bank-accounts/:accountId', adminOnly, handle(async (req, res) => {
  res.json(await bank.updateBankAccount(actorOf(req), await subjectOf(req), req.params.accountId, req.body ?? {}));
}));

router.delete('/:id/bank-accounts/:accountId', adminOnly, handle(async (req, res) => {
  await bank.deleteBankAccount(actorOf(req), await subjectOf(req), req.params.accountId);
  res.status(204).end();
}));

router.post('/:id/bank-accounts/:accountId/reveal', requireRole('superadmin'), handle(async (req, res) => {
  res.json(await bank.revealBankAccount(actorOf(req), await subjectOf(req), req.params.accountId));
}));

// ── Notes ──────────────────────────────────────────────────

router.get('/:id/notes', staffOnly, handle(async (req, res) => {
  res.json(await bank.listNotes((await subjectOf(req)).id));
}));

router.post('/:id/notes', staffOnly, handle(async (req, res) => {
  res.status(201).json(await bank.createNote(actorOf(req), await subjectOf(req), req.body ?? {}));
}));

export default router;
