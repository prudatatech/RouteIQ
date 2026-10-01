/**
 * margixindia — Zod schemas for organisations, their members and 3PL affiliations (docs/tenancy-design.md §5).
 */
import { z } from 'zod';
import { ORG_ROLES } from '../core/org-context';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).transform(v => (v === '' ? null : v)).nullable().optional();

const GSTIN = /^(0[1-9]|[12][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const details = {
  legal_name: optionalText(255),
  gstin: z.string().trim().toUpperCase().regex(GSTIN, 'GSTIN is not valid').nullable().optional(),
  pan: z.string().trim().toUpperCase().regex(PAN, 'PAN is not valid').nullable().optional(),
  state: optionalText(100),
  city: optionalText(100),
  address: optionalText(500),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Pincode must be 6 digits').nullable().optional(),
  phone: optionalText(30),
  email: z.string().trim().toLowerCase().email('Email is not valid').max(255).nullable().optional(),
};

/** PATCH /org: the details an owner or admin may change. Type and approval are never here. */
export const OrgUpdateSchema = z.object({
  name: text(255).min(2, 'Name must be at least 2 characters').optional(),
  ...details,
  profile: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type OrgUpdate = z.infer<typeof OrgUpdateSchema>;

/** POST /orgs: register a logistic company or a vendor organisation. */
export const OrgCreateSchema = z.object({
  kind: z.enum(['logistic_company', 'vendor']),
  name: text(255).min(2, 'Name must be at least 2 characters'),
  ...details,
}).strict();
export type OrgCreate = z.infer<typeof OrgCreateSchema>;

export const MemberInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email is not valid').optional(),
  phone: z.string().trim().min(5).max(30).optional(),
  role: z.enum(ORG_ROLES),
}).strict().refine(v => !!v.email !== !!v.phone, { message: 'Give either an email or a phone number' });
export type MemberInvite = z.infer<typeof MemberInviteSchema>;

export const MemberUpdateSchema = z.object({
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(['active', 'removed']).optional(),
}).strict().refine(v => v.role !== undefined || v.status !== undefined, { message: 'Give a role or a status' });
export type MemberUpdate = z.infer<typeof MemberUpdateSchema>;

export const AdminOrgFilterSchema = z.object({
  kind: z.enum(['platform', 'logistic_company', 'vendor', 'tpl_partner']).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AdminOrgDecisionSchema = z.object({
  reason: text(500).optional(),
}).strict();

export const AffiliationRequestSchema = z.object({
  company_id: z.string().uuid('company_id is not valid'),
}).strict();
