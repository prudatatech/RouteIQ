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

// ── Logistic-company KYC documents (mirrors vendor KYC, schemas/vendor.ts) ──

/** How the documents a logistic company uploads are named in the review. */
export const ORG_DOC_LABELS: Record<string, string> = {
  gstRegistration: 'GST registration',
  panScan: 'PAN card',
  companyRegistration: 'Company registration / incorporation certificate',
  cancelledCheque: 'Cancelled cheque',
  addressProof: 'Registered address proof',
};
export const REQUIRED_ORG_DOC_KEYS = Object.keys(ORG_DOC_LABELS);

const ORG_DOC_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const MAX_OTHER_ORG_DOCS = 10;

const OtherOrgDocSchema = z.object({
  name: z.string().trim().min(1).max(200),
  path: z.string().min(1).max(300),
});

/** Storage paths of KYC files: <org id>/<file>, no folder tricks. */
export function isOwnOrgDocPath(orgId: string, path: unknown): path is string {
  return typeof path === 'string'
    && path.length <= 300
    && path.startsWith(`${orgId}/`)
    && !path.includes('..')
    && !path.slice(orgId.length + 1).includes('/');
}

export const OrgDocumentsSchema = z.object({
  docUrls: z.record(z.string(), z.string().min(1).max(300)).optional(),
  otherDocs: z.array(OtherOrgDocSchema).max(MAX_OTHER_ORG_DOCS, `Attach at most ${MAX_OTHER_ORG_DOCS} other documents`).optional(),
}).refine(v => v.docUrls !== undefined || v.otherDocs !== undefined, 'Nothing to save');
export type OrgDocumentsInput = z.infer<typeof OrgDocumentsSchema>;

/** Checks every document path lives in the company's own folder. Throws a 400 via the caller. */
export function assertOwnOrgDocumentPaths(orgId: string, docUrls?: Record<string, string>, otherDocs?: { name: string; path: string }[]): string | null {
  for (const [key, path] of Object.entries(docUrls ?? {})) {
    if (!ORG_DOC_KEY.test(key)) return `Invalid document name: ${key}`;
    if (!isOwnOrgDocPath(orgId, path)) return 'Documents must be your own uploads';
  }
  for (const doc of otherDocs ?? []) {
    if (!isOwnOrgDocPath(orgId, doc.path)) return 'Documents must be your own uploads';
  }
  return null;
}

export const FlagOrgDocumentsSchema = z.object({
  issues: z.record(z.string(), z.string().trim().min(3, 'Say what is wrong with each document (at least 3 characters)').max(300, 'Reason is too long (at most 300 characters)'))
    .refine(issues => Object.keys(issues).length > 0, 'Flag at least one document'),
});
export type FlagOrgDocumentsInput = z.infer<typeof FlagOrgDocumentsSchema>;
