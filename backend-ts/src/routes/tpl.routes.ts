/**
 * margixindia — 3PL partner onboarding routes
 *
 * Public: onboarding, application tracking (status only), password setup.
 * Applicants may view or edit their pending application with its PAN.
 * Partners see their own record; superadmins manage the network.
 */
import { Router, Request, Response } from 'express';
import { tplService } from '../services/tpl.service';
import { optionalAuth, requireAuth, requireRole } from '../core/auth';
import { isStaff } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { consumeRateLimit, rateLimitByIp, rateLimitByUser } from '../core/rate-limit';
import { settings } from '../core/config';

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Status-only view of an application, safe to show to anyone with the tracking ID. */
function publicView(partner: any) {
  return {
    id: partner.id,
    custom_id: partner.custom_id,
    company_name: partner.company_name,
    status: partner.status,
    created_at: partner.created_at,
    rejection_reason: partner.status === 'rejected' ? partner.rejection_reason ?? null : null,
    email_masked: maskEmail(partner.email),
    corridor_count: partner.tpl_corridors?.length ?? 0,
    document_count: partner.tpl_documents?.length ?? 0,
  };
}

async function panMatches(req: Request, partner: any, pan: unknown): Promise<boolean> {
  if (typeof pan !== 'string' || !pan) return false;
  if (!(await consumeRateLimit(`tpl:pan:${partner.id}:${req.ip}`, 10, 15 * 60))) {
    throw new HttpError(429, 'Too many attempts. Please try again later.');
  }
  return typeof partner.pan_number === 'string' && partner.pan_number.toUpperCase() === pan.trim().toUpperCase();
}

// POST /api/v1/tpl/onboard
router.post('/onboard', rateLimitByIp('tpl-onboard', 5, 60 * 60), async (req, res) => {
  try {
    const partner = await tplService.onboard(req.body);
    res.json({ success: true, data: { id: partner.id, custom_id: partner.custom_id, status: partner.status } });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/applications/upload-url — signed URL to upload one document.
// New application: { custom_id, doc_type, content_type, size }.
// Existing one: { application_id, doc_type, content_type, size } as staff or the
// partner, or with verify_pan while the application is pending.
router.post('/applications/upload-url', rateLimitByIp('tpl-upload-url', settings.TPL_UPLOAD_URLS_PER_HOUR, 60 * 60), optionalAuth, async (req, res) => {
  try {
    const { application_id, custom_id, doc_type, content_type, size, verify_pan } = req.body ?? {};
    let partnerId: string | undefined;
    if (application_id !== undefined) {
      if (typeof application_id !== 'string' || !application_id) throw new HttpError(400, 'application_id must be a string');
      const partner = await tplService.getPartner(application_id);
      const owner = isStaff(req.user) || (!!req.user && partner.user_id === req.user.user_id);
      if (!owner) {
        if (!(await panMatches(req, partner, verify_pan))) throw new HttpError(403, 'PAN does not match this application');
        if (partner.status !== 'pending') throw new HttpError(409, 'Only pending applications can be edited');
      }
      partnerId = partner.id;
    }
    const upload = await tplService.createDocumentUploadUrl({
      docType: doc_type, contentType: content_type, size, customId: custom_id, partnerId,
    });
    res.json(upload);
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/tpl/queue
router.get('/queue', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const status = req.query.status as string || 'pending';
    res.json(await tplService.getQueue(status));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/tpl/by-user/:userId
router.get('/by-user/:userId', requireAuth, async (req, res) => {
  try {
    if (req.params.userId !== req.user!.user_id && !isStaff(req.user)) {
      throw new HttpError(403, 'Not authorized');
    }
    res.json(await tplService.getPartnerByUserId(req.params.userId));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /api/v1/tpl/:id  — full record for staff, the partner, or an applicant with the PAN
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const partner = await tplService.getPartner(req.params.id);
    const full = isStaff(req.user)
      || (req.user && partner.user_id === req.user.user_id)
      || (await panMatches(req, partner, req.query.pan));
    res.json(full ? partner : publicView(partner));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/approve/:id
router.post('/approve/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const data = await tplService.approve(req.params.id, req.user!);
    res.json({ success: true, data });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/reject/:id
router.post('/reject/:id', requireAuth, requireRole('superadmin'), async (req: Request, res: Response) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) throw new HttpError(400, 'A reason is required');
    const data = await tplService.reject(req.params.id, reason, req.user!);
    res.json({ success: true, data });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// PATCH /api/v1/tpl/:id  — staff, or the applicant proving ownership with the PAN
router.patch('/:id', optionalAuth, async (req, res) => {
  try {
    if (!isStaff(req.user)) {
      const partner = await tplService.getPartner(req.params.id);
      if (!(await panMatches(req, partner, req.body.verify_pan))) {
        throw new HttpError(403, 'PAN does not match this application');
      }
    }
    const data = await tplService.updateApplication(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/:id/documents/:docId/replace — the partner swaps one of its documents.
// The new file was uploaded through /applications/upload-url; the partner goes back to review.
router.post('/:id/documents/:docId/replace', requireAuth, rateLimitByUser('tpl-doc-replace', 30, 60 * 60), async (req, res) => {
  try {
    const data = await tplService.replaceDocument(req.params.id, req.params.docId, req.body?.path, req.user!);
    res.json({ success: true, data });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/:id/settings — the partner requests new SLA, tax treatment or corridors.
// Nothing is applied until staff approve; the partner goes back to review meanwhile.
router.post('/:id/settings', requireAuth, rateLimitByUser('tpl-settings', 30, 60 * 60), async (req, res) => {
  try {
    const data = await tplService.requestSettingsUpdate(req.params.id, req.body ?? {}, req.user!);
    res.json({ success: true, data });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/:id/pause
router.post('/:id/pause', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ success: true, data: await tplService.pausePartner(req.params.id, req.user!) });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/:id/resume
router.post('/:id/resume', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ success: true, data: await tplService.resumePartner(req.params.id, req.user!) });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// DELETE /api/v1/tpl/:id
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    res.json({ success: true, data: await tplService.deletePartner(req.params.id, req.user!) });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/auth/send-otp
router.post('/auth/send-otp', rateLimitByIp('tpl-otp-send', 10, 60 * 60), async (req: Request, res: Response) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'A valid email is required');
    if (!(await consumeRateLimit(`tpl-otp-send:email:${email}`, 3, 10 * 60))) {
      throw new HttpError(429, 'Too many codes requested. Please wait a few minutes.');
    }
    await tplService.sendSetupOtp(email);
    res.json({ success: true, message: 'If this email belongs to an approved partner, a code has been sent.' });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /api/v1/tpl/auth/setup-password
router.post('/auth/setup-password', rateLimitByIp('tpl-otp-verify', 20, 60 * 60), async (req: Request, res: Response) => {
  try {
    const { otp, password } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || typeof otp !== 'string' || typeof password !== 'string') {
      throw new HttpError(400, 'Email, code and password are required');
    }
    if (password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
    await tplService.verifyAndSetupPassword(email, otp.trim(), password);
    res.json({ success: true });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

export default router;
