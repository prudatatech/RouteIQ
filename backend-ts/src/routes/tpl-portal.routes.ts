/**
 * margixindia — 3PL partner portal API (docs/network-design.md, section 2)
 *
 *   /tpl-portal/:id/vehicles            the partner's own fleet (list, add, edit)
 *   /tpl-portal/:id/drivers             the partner's drivers, and inviting one by phone
 *   /tpl-portal/:id/statements          what companies issued to the partner (read only), and the PDF
 *
 * `:id` is the partner organisation (a tpl_partner organisation the caller is a member of); the id of the older
 * tpl_partners row is accepted too. Everything here is for members of that organisation, not a vendor role.
 */
import { Request, RequestHandler, Response, Router } from 'express';
import { requireAuth } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { isUuid, uuidParam } from '../core/validate';
import type { OrgSummary } from '../core/org-context';
import * as fleet from '../services/tpl-fleet.service';
import { createVehiclePhotoUploadUrl, deleteVehiclePhoto, listVehiclePhotos, saveVehiclePhoto } from '../services/vehicle-photos.service';
import { legacyPartnerIdOf } from '../services/tpl-affiliation';
import { tplStatementService } from '../services/tpl-statement.service';
import { renderStatementPdf, statementFileName } from '../services/tpl-statement-pdf';

const router = Router();
router.use(requireAuth);

const handle = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    sendError(req, res, e);
  }
};

/**
 * The partner organisation named by `:id`, which the caller must belong to. Reads are open to every member; writes
 * need the organisation to be active and a member who is not a driver.
 */
async function partnerOrg(req: Request, write = false): Promise<OrgSummary> {
  const id = req.params.id;
  if (!isUuid(id)) throw new HttpError(404, 'Partner not found');
  const mine = (req.memberships ?? []).filter(m => m.org.kind === 'tpl_partner');
  let seat = mine.find(m => m.org.id === id.toLowerCase());
  if (!seat) {
    for (const m of mine) {
      if ((await legacyPartnerIdOf(m.org.id)) === id) { seat = m; break; }
    }
  }
  if (!seat) throw new HttpError(403, 'You are not a member of that partner organisation');
  if (write) {
    if (seat.org.status !== 'active') throw new HttpError(403, 'Your partner account is not active yet');
    if (seat.role === 'driver') throw new HttpError(403, 'Not authorized for this action');
  }
  return seat.org;
}

// ── Vehicles ─────────────────────────────────────────────────

// GET /tpl-portal/:id/vehicles  ->  { items: vehicle rows + documents[], docs_status, usable }
router.get('/:id/vehicles', handle(async (req, res) => {
  res.json({ items: await fleet.listVehicles((await partnerOrg(req)).id) });
}));

// POST /tpl-portal/:id/vehicles  { plate_number, vehicle_type, capacity_kg, body_type?, rc_number?, insurance_number?, ... }
router.post('/:id/vehicles', handle(async (req, res) => {
  const org = await partnerOrg(req, true);
  res.status(201).json(await fleet.createVehicle(org.id, req.user!.user_id, req.body));
}));

// PATCH /tpl-portal/:id/vehicles/:vid  any of the same fields, plus status and driver_id
router.patch('/:id/vehicles/:vid', handle(async (req, res) => {
  const org = await partnerOrg(req, true);
  res.json(await fleet.updateVehicle(org.id, uuidParam(req.params.vid, 'Vehicle not found'), req.body));
}));

// ── Vehicle photos and document copies (the same slots and signed upload as a company's vehicle) ──

router.get('/:id/vehicles/:vid/photos', handle(async (req, res) => {
  const org = await partnerOrg(req);
  await fleet.ownVehicle(org.id, uuidParam(req.params.vid, 'Vehicle not found'));
  res.json(await listVehiclePhotos(req.params.vid));
}));

// POST { slot, content_type, size } -> { path, signed_url, ... }: PUT the file there, then PUT .../photos/:slot { file_path }
router.post('/:id/vehicles/:vid/photos/upload-url', handle(async (req, res) => {
  const org = await partnerOrg(req, true);
  await fleet.ownVehicle(org.id, uuidParam(req.params.vid, 'Vehicle not found'));
  res.json(await createVehiclePhotoUploadUrl(req.params.vid, req.body ?? {}));
}));

router.put('/:id/vehicles/:vid/photos/:slot', handle(async (req, res) => {
  const org = await partnerOrg(req, true);
  await fleet.ownVehicle(org.id, uuidParam(req.params.vid, 'Vehicle not found'));
  res.json(await saveVehiclePhoto(req.params.vid, req.params.slot, req.body?.file_path, req.user!.user_id));
}));

router.delete('/:id/vehicles/:vid/photos/:slot', handle(async (req, res) => {
  const org = await partnerOrg(req, true);
  await fleet.ownVehicle(org.id, uuidParam(req.params.vid, 'Vehicle not found'));
  await deleteVehiclePhoto(req.params.vid, req.params.slot);
  res.status(204).send();
}));

// ── Drivers ──────────────────────────────────────────────────

router.get('/:id/drivers', handle(async (req, res) => {
  res.json({ items: await fleet.listDrivers((await partnerOrg(req)).id) });
}));

// GET /tpl-portal/:id/drivers  ->  { items: [{ id, full_name, phone, status, is_active, vehicle: { id, plate_number } | null }] }
// POST /tpl-portal/:id/drivers/invite  { full_name | name, phone }
router.post('/:id/drivers/invite', handle(async (req, res) => {
  const org = await partnerOrg(req, true);
  res.status(201).json(await fleet.inviteDriver({ user_id: req.user!.user_id, role: req.user!.role }, org.id, req.body));
}));

// ── Statements (issued by companies) ─────────────────────────

router.get('/:id/statements', handle(async (req, res) => {
  res.json({ items: await tplStatementService.listForPartner((await partnerOrg(req)).id) });
}));

router.get('/:id/statements/:sid', handle(async (req, res) => {
  res.json(await tplStatementService.getForPartner((await partnerOrg(req)).id, uuidParam(req.params.sid, 'Statement not found')));
}));

router.get('/:id/statements/:sid/pdf', handle(async (req, res) => {
  const statement = await tplStatementService.getForPartner((await partnerOrg(req)).id, uuidParam(req.params.sid, 'Statement not found'));
  const pdf = await renderStatementPdf(statement, await tplStatementService.partiesOf(statement));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${statementFileName(statement)}"`);
  res.send(pdf);
}));

export default router;
