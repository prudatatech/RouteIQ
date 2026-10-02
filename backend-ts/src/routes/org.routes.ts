/**
 * margixindia — Organisation routes (docs/tenancy-design.md §5)
 *
 *   /orgs   the caller's organisations (for the switcher), and registering a new one
 *   /org    the active organisation: its profile, members and 3PL partners (owner or admin)
 *   /admin/orgs        platform admins: list organisations, approve, reject, suspend
 *   /tpl/affiliations  a 3PL organisation asks to join a logistic company
 */
import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { requireAuth } from '../core/auth';
import { HttpError, parseRejectionReason, sendError } from '../core/errors';
import { rateLimitByUser } from '../core/rate-limit';
import { uuidParam } from '../core/validate';
import { appRoleFor, type OrgRole } from '../core/org-context';
import {
  AdminOrgDecisionSchema, AdminOrgFilterSchema, AffiliationRequestSchema, MemberInviteSchema, MemberUpdateSchema, OrgCreateSchema, OrgUpdateSchema,
} from '../schemas/org';
import * as orgs from '../services/org.service';
import { AffiliationRulesSchema, resolveTplOrg } from '../services/tpl-affiliation';
import { fleetSummaryFor } from '../services/tpl-fleet.service';
import { StatementBuildSchema, StatementPaidSchema, StatementUpdateSchema, tplStatementService } from '../services/tpl-statement.service';
import { renderStatementPdf, statementFileName } from '../services/tpl-statement-pdf';

const handle = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    sendError(req, res, e);
  }
};

function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? String(issue.path[0]) : undefined;
    throw new HttpError(422, issue?.message ?? 'The request is not valid', field ? { field } : undefined);
  }
  return result.data;
}

const actorOf = (req: Request) => ({ user_id: req.user!.user_id, role: req.user!.role });

/** The caller must act for an organisation where they hold one of `roles` (any role when none are given). */
const inOrg = (...roles: OrgRole[]) => (req: Request, res: Response, next: NextFunction): void => {
  if (!req.org) {
    res.status(403).json({ detail: 'You are not a member of an organisation' });
    return;
  }
  if (roles.length && !(req.orgRole && roles.includes(req.orgRole))) {
    res.status(403).json({ detail: 'Not authorized for this action' });
    return;
  }
  next();
};

/** Same, and the organisation must be of this kind. */
const ofKind = (kind: 'logistic_company' | 'tpl_partner', ...roles: OrgRole[]) => (req: Request, res: Response, next: NextFunction): void => {
  if (req.org?.kind !== kind) {
    res.status(403).json({ detail: kind === 'tpl_partner' ? 'Only a 3PL partner organisation can do this' : 'Only a logistic company can do this' });
    return;
  }
  inOrg(...roles)(req, res, next);
};

const platformAdminOnly = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.isPlatformAdmin) {
    res.status(403).json({ detail: 'Platform admins only' });
    return;
  }
  next();
};

const OWNER_OR_ADMIN: OrgRole[] = ['owner', 'admin'];

// ── /orgs ──────────────────────────────────────────────────
export const orgsRouter = Router();
orgsRouter.use(requireAuth);

// The caller's organisations, for the switcher. Empty for a customer or before organisations are set up.
orgsRouter.get('/mine', handle(async (req, res) => {
  res.json((req.memberships ?? []).map(m => ({ org: { id: m.org.id, kind: m.org.kind, name: m.org.name, status: m.org.status }, role: m.role, app_role: appRoleFor(m, req.user!.base_role ?? req.user!.role) })));
}));

orgsRouter.post('/', rateLimitByUser('org-create', 5, 60 * 60), handle(async (req, res) => {
  if (req.user!.role === 'customer') throw new HttpError(403, 'Not authorized for this action');
  res.status(201).json(await orgs.createOrg(actorOf(req), parse(OrgCreateSchema, req.body)));
}));

// ── /org ───────────────────────────────────────────────────
export const orgRouter = Router();
orgRouter.use(requireAuth);

orgRouter.get('/', inOrg(...OWNER_OR_ADMIN), handle(async (req, res) => {
  res.json(await orgs.getOrg(req.org!.id));
}));

orgRouter.patch('/', inOrg(...OWNER_OR_ADMIN), handle(async (req, res) => {
  res.json(await orgs.updateOrg(actorOf(req), req.org!.id, parse(OrgUpdateSchema, req.body)));
}));

orgRouter.get('/members', inOrg(...OWNER_OR_ADMIN), handle(async (req, res) => {
  res.json(await orgs.listMembers(req.org!.id));
}));

orgRouter.post('/members', inOrg(...OWNER_OR_ADMIN), handle(async (req, res) => {
  res.status(201).json(await orgs.inviteMember(actorOf(req), req.orgRole!, req.org!.id, parse(MemberInviteSchema, req.body)));
}));

orgRouter.patch('/members/:userId', inOrg(...OWNER_OR_ADMIN), handle(async (req, res) => {
  const userId = uuidParam(req.params.userId, 'Member not found');
  res.json(await orgs.updateMember(actorOf(req), req.orgRole!, req.org!.id, userId, parse(MemberUpdateSchema, req.body)));
}));

orgRouter.get('/tpl-affiliations', ofKind('logistic_company', ...OWNER_OR_ADMIN), handle(async (req, res) => {
  res.json(await orgs.listCompanyAffiliations(req.org!.id));
}));

for (const action of ['approve', 'pause', 'end'] as const) {
  orgRouter.put(`/tpl-affiliations/:tplId/${action}`, ofKind('logistic_company', ...OWNER_OR_ADMIN), handle(async (req, res) => {
    const tplId = uuidParam(req.params.tplId, 'Affiliation not found');
    res.json(await orgs.decideAffiliation(actorOf(req), req.org!.id, tplId, action));
  }));
}

// PATCH /org/tpl-affiliations/:tplId/rules  { vehicle_classes?, corridor_ids?, min_rate_per_km?, gps_required?, insurance_required? }
// (the rules object itself, or { rules: {...} }); replaces the rules as a whole. Answers { company_id, tpl_id, status, rules }.
orgRouter.patch('/tpl-affiliations/:tplId/rules', ofKind('logistic_company', ...OWNER_OR_ADMIN), handle(async (req, res) => {
  const tplId = await resolveTplOrg(req.org!.id, req.params.tplId);
  const body = req.body && typeof req.body === 'object' && 'rules' in req.body && Object.keys(req.body).length === 1 ? req.body.rules : req.body;
  res.json(await orgs.updateAffiliationRules(actorOf(req), req.org!.id, tplId, parse(AffiliationRulesSchema, body)));
}));

// GET /org/tpl-affiliations/:tplId  one partner of the company: { tpl_id, status, rules, organization, ... }
// (:tplId is the partner organisation, or the id of the older tpl_partners row)
orgRouter.get('/tpl-affiliations/:tplId', ofKind('logistic_company', ...OWNER_OR_ADMIN), handle(async (req, res) => {
  res.json(await orgs.getCompanyAffiliation(req.org!.id, await resolveTplOrg(req.org!.id, req.params.tplId)));
}));

// GET /org/tpl-affiliations/:tplId/fleet  counts only, never the partner's documents
orgRouter.get('/tpl-affiliations/:tplId/fleet', ofKind('logistic_company'), handle(async (req, res) => {
  res.json(await fleetSummaryFor(req.org!.id, await resolveTplOrg(req.org!.id, req.params.tplId)));
}));

// ── Partner statements (the company's side) ────────────────
const statementsOf = async (req: Request) => ({ company: req.org!.id, tpl: await resolveTplOrg(req.org!.id, req.params.tplId) });
const statementId = (req: Request) => uuidParam(req.params.sid, 'Statement not found');
const statementAuth = ofKind('logistic_company', ...OWNER_OR_ADMIN);

orgRouter.get('/tpl-affiliations/:tplId/statements', statementAuth, handle(async (req, res) => {
  const { company, tpl } = await statementsOf(req);
  res.json({ items: await tplStatementService.list(company, tpl) });
}));

// POST { period: 'YYYYMM' }: 201 for a new draft, 200 when the month's draft was refreshed
orgRouter.post('/tpl-affiliations/:tplId/statements', statementAuth, handle(async (req, res) => {
  const { company, tpl } = await statementsOf(req);
  const { statement, created } = await tplStatementService.build(actorOf(req), company, tpl, parse(StatementBuildSchema, req.body).period);
  res.status(created ? 201 : 200).json(statement);
}));

orgRouter.get('/tpl-affiliations/:tplId/statements/:sid', statementAuth, handle(async (req, res) => {
  const { company, tpl } = await statementsOf(req);
  res.json(await tplStatementService.get(company, tpl, statementId(req)));
}));

// PATCH { deductions: [{ label, amount_paise, reason? }] } replaces the deductions; { rebuild: true } pulls the orders again
orgRouter.patch('/tpl-affiliations/:tplId/statements/:sid', statementAuth, handle(async (req, res) => {
  const { company, tpl } = await statementsOf(req);
  res.json(await tplStatementService.update(actorOf(req), company, tpl, statementId(req), parse(StatementUpdateSchema, req.body)));
}));

orgRouter.post('/tpl-affiliations/:tplId/statements/:sid/issue', statementAuth, handle(async (req, res) => {
  const { company, tpl } = await statementsOf(req);
  res.json(await tplStatementService.issue(actorOf(req), company, tpl, statementId(req)));
}));

// POST { reference? }
orgRouter.post('/tpl-affiliations/:tplId/statements/:sid/mark-paid', statementAuth, handle(async (req, res) => {
  const { company, tpl } = await statementsOf(req);
  res.json(await tplStatementService.markPaid(actorOf(req), company, tpl, statementId(req), parse(StatementPaidSchema, req.body).reference));
}));

orgRouter.get('/tpl-affiliations/:tplId/statements/:sid/pdf', statementAuth, handle(async (req, res) => {
  const { company, tpl } = await statementsOf(req);
  const statement = await tplStatementService.get(company, tpl, statementId(req));
  const pdf = await renderStatementPdf(statement, await tplStatementService.partiesOf(statement));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${statementFileName(statement)}"`);
  res.send(pdf);
}));

// ── /admin/orgs ────────────────────────────────────────────
export const adminOrgsRouter = Router();
adminOrgsRouter.use(requireAuth, platformAdminOnly);

adminOrgsRouter.get('/', handle(async (req, res) => {
  res.json(await orgs.listOrgs(parse(AdminOrgFilterSchema, req.query)));
}));

for (const decision of ['approve', 'reject', 'suspend'] as const) {
  adminOrgsRouter.put(`/:id/${decision}`, handle(async (req, res) => {
    const id = uuidParam(req.params.id, 'Organisation not found');
    const body = parse(AdminOrgDecisionSchema, req.body);
    let reason = body.reason;
    if (decision === 'reject') {
      try {
        reason = parseRejectionReason(body.reason);
      } catch (e) {
        throw e instanceof HttpError ? new HttpError(422, e.message, { field: 'reason' }) : e;
      }
    }
    res.json(await orgs.decideOrg(actorOf(req), id, decision, reason));
  }));
}

// ── /tpl/affiliations ──────────────────────────────────────
export const tplAffiliationsRouter = Router();
tplAffiliationsRouter.use(requireAuth);

tplAffiliationsRouter.post('/', ofKind('tpl_partner', ...OWNER_OR_ADMIN), handle(async (req, res) => {
  const { company_id } = parse(AffiliationRequestSchema, req.body);
  res.status(201).json(await orgs.requestAffiliation(actorOf(req), req.org!.id, company_id));
}));

tplAffiliationsRouter.get('/', ofKind('tpl_partner', ...OWNER_OR_ADMIN), handle(async (req, res) => {
  res.json(await orgs.listTplAffiliations(req.org!.id));
}));
