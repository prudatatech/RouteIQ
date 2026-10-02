/**
 * margixindia — The platform's review of a vendor (docs/platform-model.md, "Reviewing a vendor").
 *
 * A vendor's data lives in several places: the sign-in account (users), the business organisation (name, GSTIN,
 * address, account and business type) and the KYC profile (vendor_profiles: the form, documents, decision). The
 * registry lists every vendor, with or without a KYC profile, and the detail merges the three. The platform can ask the
 * vendor for more information (kyc_info_requests) while a KYC is waiting; the vendor answers, and the KYC goes back to
 * review. Platform only: the routes require the superadmin role.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { invalidateOrgContext } from '../core/org-context';
import { isUuid } from '../core/validate';
import { isOwnKycPath } from '../schemas/vendor';
import { notificationService } from './notification.service';
import { auditService, type AuditActor } from './audit.service';
import { selectIn } from './finance.service';

export const KYC_STATUSES = ['pending', 'submitted', 'info_requested', 'approved', 'rejected'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

/** How the documents the vendor uploads in the wizard are named in the review. */
const DOC_LABELS: Record<string, string> = {
  softCopyExcel: 'Vendor form (spreadsheet)',
  softCopyPdf: 'Vendor form (PDF)',
  panScan: 'PAN card',
  cancelledCheque: 'Cancelled cheque',
  gstRegistration: 'GST registration',
  msmeCert: 'MSME certificate',
  companyLogo: 'Company logo',
};

/** People who are not vendors even if they hold a vendor profile row. */
const NON_VENDOR_ROLES = new Set(['admin', 'superadmin', 'manager', 'driver']);
const PAGE = 1000;

export interface InfoItem { key: string; label: string; kind: 'text' | 'document'; hint?: string | null }
export interface InfoAnswer { key: string; text?: string; document_path?: string }

async function pagedRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read ${what}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

const realEmail = (e: string | null | undefined) => (e && !/\.margixindia\.local$/i.test(e) ? e : null);

export interface RegistryQuery { status?: string; q?: string; limit?: number; offset?: number }

export const vendorReviewService = {
  /** Every vendor user, with the KYC profile and business organisation they have (a vendor that never filed KYC is 'pending'). */
  async registry(query: RegistryQuery) {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Math.trunc(query.offset ?? 0) || 0, 0);

    const [users, profiles, partners, orgs] = await Promise.all([
      pagedRows<any>((f, t) => supabase.from('users').select('id, email, full_name, phone, role, created_at').eq('role', 'vendor').order('created_at', { ascending: false }).range(f, t), 'vendors'),
      pagedRows<any>((f, t) => supabase.from('vendor_profiles').select('id, company_name, gst_number, city, kyc_status, kyc_reviewed_at, updated_at').range(f, t), 'vendor profiles'),
      pagedRows<any>((f, t) => supabase.from('tpl_partners').select('user_id').range(f, t), 'partners'),
      pagedRows<any>((f, t) => supabase.from('organizations').select('id, name, legal_name, gstin, city, status, profile').eq('kind', 'vendor').range(f, t), 'organisations'),
    ]);

    const byId = new Map<string, any>(users.map(u => [u.id as string, u]));
    // A person with a vendor profile acts as a vendor even when their stored role differs
    const extra = profiles.map(p => p.id as string).filter(id => !byId.has(id));
    for (const u of await selectIn<any>('users', 'id', extra, 'id, email, full_name, phone, role, created_at')) {
      if (!NON_VENDOR_ROLES.has(u.role)) byId.set(u.id, u);
    }
    const partnerIds = new Set(partners.map(p => p.user_id as string | null).filter(Boolean) as string[]);
    const profileOf = new Map<string, any>(profiles.map(p => [p.id as string, p]));
    const orgOf = new Map<string, any>();
    for (const o of orgs) {
      const legacy = (o.profile as Record<string, unknown> | null)?.legacy_user_id;
      if (typeof legacy === 'string') orgOf.set(legacy, o);
    }

    const rows = [...byId.values()].filter(u => !partnerIds.has(u.id)).map(u => {
      const p = profileOf.get(u.id);
      const o = orgOf.get(u.id);
      return {
        id: u.id as string,
        name: (p?.company_name || o?.legal_name || o?.name || u.full_name || realEmail(u.email) || 'Vendor') as string,
        email: realEmail(u.email),
        phone: (u.phone as string | null) ?? null,
        created_at: u.created_at as string,
        kyc_status: (p?.kyc_status ?? 'pending') as string,
        org_status: (o?.status as string | undefined) ?? null,
        gstin: ((p?.gst_number && p.gst_number !== 'PENDING' ? p.gst_number : null) ?? o?.gstin ?? null) as string | null,
        city: ((p?.city || o?.city) ?? null) as string | null,
        updated_at: (p?.updated_at as string | undefined) ?? null,
        kyc_reviewed_at: (p?.kyc_reviewed_at as string | undefined) ?? null,
        open_requests: 0,
      };
    });

    const status = query.status && (KYC_STATUSES as readonly string[]).includes(query.status) ? query.status : null;
    const needle = (query.q ?? '').trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const filtered = rows.filter(r => {
      if (status && r.kyc_status !== status) return false;
      if (!needle) return true;
      return [r.name, r.gstin, r.email, r.city].some(v => v && v.toLowerCase().includes(needle))
        || (digits.length >= 3 && (r.phone ?? '').replace(/\D/g, '').includes(digits));
    });
    filtered.sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));
    const items = filtered.slice(offset, offset + limit);

    const open = await selectIn<{ vendor_id: string }>('kyc_info_requests', 'vendor_id', items.map(i => i.id), 'vendor_id', q => q.eq('status', 'open'));
    for (const r of open) {
      const item = items.find(i => i.id === r.vendor_id);
      if (item) item.open_requests += 1;
    }
    return { items, total: filtered.length };
  },

  /** One vendor in full: account, business, KYC form and documents, information requests, history, activity. */
  async detail(vendorId: string) {
    if (!isUuid(vendorId)) throw new HttpError(404, 'Vendor not found');
    const [{ data: user, error: uErr }, { data: profile, error: pErr }, { data: partner }] = await Promise.all([
      supabase.from('users').select('id, email, full_name, phone, role, created_at').eq('id', vendorId).maybeSingle(),
      supabase.from('vendor_profiles').select('id, company_name, gst_number, city, address, kyc_status, kyc_data, kyc_reviewed_at, kyc_rejection_reason, updated_at').eq('id', vendorId).maybeSingle(),
      supabase.from('tpl_partners').select('id').eq('user_id', vendorId).maybeSingle(),
    ]);
    if (uErr) throw new Error(`Failed to read the vendor: ${uErr.message}`);
    if (pErr) throw new Error(`Failed to read the vendor: ${pErr.message}`);
    if (!user || partner || NON_VENDOR_ROLES.has(user.role) || (user.role !== 'vendor' && !profile)) throw new HttpError(404, 'Vendor not found');

    const members = await selectIn<{ org_id: string; role: string }>('org_members', 'user_id', [vendorId], 'org_id, role');
    const orgs = await selectIn<any>('organizations', 'id', members.map(m => m.org_id), 'id, kind, name, legal_name, gstin, address, pincode, state, email, status, profile');
    const org = orgs.find(o => o.kind === 'vendor') ?? null;
    const meta = (org?.profile ?? {}) as Record<string, any>;

    let lastSignIn: string | null = null;
    let authPhone: string | null = null;
    try {
      const { data } = await supabase.auth.admin.getUserById(vendorId);
      lastSignIn = data?.user?.last_sign_in_at ?? null;
      authPhone = data?.user?.phone || null;
    } catch (e) {
      console.error('[vendor-review] sign-in lookup failed:', e);
    }

    const kycData = (profile?.kyc_data ?? {}) as Record<string, any>;
    const form = (kycData.data ?? {}) as Record<string, unknown>;
    const docUrls = (form.docUrls ?? {}) as Record<string, unknown>;
    const documents: { key: string; label: string; path: string }[] = [];
    for (const [key, path] of Object.entries(docUrls)) {
      if (typeof path === 'string' && path) documents.push({ key, label: DOC_LABELS[key] ?? key, path });
    }
    (Array.isArray(kycData.otherDocs) ? kycData.otherDocs : []).forEach((d: any, i: number) => {
      if (d && typeof d.path === 'string' && d.path) documents.push({ key: `other_${i + 1}`, label: String(d.name || 'Other document'), path: d.path });
    });

    const [requests, logs, loads, invoices] = await Promise.all([
      supabase.from('kyc_info_requests').select('id, message, items, status, requested_at, requested_by, answered_at, answers').eq('vendor_id', vendorId).order('requested_at', { ascending: false }),
      supabase.from('ai_agent_logs').select('created_at, action, input_data, output_data').contains('input_data', { vendor_id: vendorId }).like('action', 'kyc_%').order('created_at', { ascending: false }).limit(200),
      supabase.from('vendor_shipment_requests').select('id, status, carrier_org_id, created_at').eq('vendor_id', vendorId).order('created_at', { ascending: false }).limit(2000),
      supabase.from('invoices').select('id').eq('vendor_id', vendorId).neq('status', 'void').limit(5000),
    ]);
    for (const r of [requests, logs, loads, invoices]) if (r.error) throw new Error(`Failed to read the vendor: ${r.error.message}`);

    const entries = (logs.data ?? []).filter((l: any) => l.input_data?.vendor_id === vendorId);
    const actorIds = [...new Set([
      ...(requests.data ?? []).map((r: any) => r.requested_by),
      ...entries.map((l: any) => l.input_data?.actor_id),
    ].filter(isUuid))] as string[];
    const names = new Map<string, string>();
    for (const a of await selectIn<any>('users', 'id', actorIds, 'id, full_name, email')) names.set(a.id, a.full_name || a.email || 'Platform');
    const nameOf = (id: unknown) => (typeof id === 'string' && names.get(id)) || 'Platform';

    const info_requests = (requests.data ?? []).map((r: any) => ({
      id: r.id, message: r.message ?? null, items: r.items ?? [], status: r.status, requested_at: r.requested_at,
      requested_by_name: nameOf(r.requested_by), answered_at: r.answered_at ?? null, answers: r.answers ?? {},
    }));

    const history = [
      ...entries.map((l: any) => ({
        at: l.created_at as string,
        actor: l.input_data?.actor_role === 'vendor' ? 'Vendor' : nameOf(l.input_data?.actor_id),
        action: l.action as string,
        detail: (l.input_data?.reason ?? l.input_data?.message ?? l.output_data ?? null) as string | null,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const loadRows = loads.data ?? [];
    return {
      account: {
        id: user.id, email: realEmail(user.email), phone: user.phone ?? authPhone, full_name: user.full_name ?? null,
        created_at: user.created_at, last_sign_in_at: lastSignIn,
      },
      business: {
        org_id: org?.id ?? null,
        org_status: org?.status ?? null,
        business_name: org?.legal_name ?? org?.name ?? profile?.company_name ?? null,
        contact_name: meta.contact_name ?? null,
        account_type: meta.account_type ?? null,
        business_type: meta.business_type ?? null,
        monthly_loads: meta.monthly_loads ?? null,
        gstin: org?.gstin ?? (profile?.gst_number && profile.gst_number !== 'PENDING' ? profile.gst_number : null),
        gstin_status: meta.gstin_status ?? null,
        address: org?.address ?? profile?.address ?? null,
        pincode: org?.pincode ?? null,
        state: org?.state ?? null,
        state_code: meta.state_code ?? null,
        email: org?.email ?? realEmail(user.email),
      },
      kyc: {
        status: (profile?.kyc_status ?? 'pending') as string,
        reviewed_at: profile?.kyc_reviewed_at ?? null,
        rejection_reason: profile?.kyc_rejection_reason ?? null,
        updated_at: profile?.updated_at ?? null,
        form,
        documents,
        ifsc_verified_at: kycData.bank?.ifsc_verified_at ?? null,
      },
      info_requests,
      history,
      activity: {
        loads_total: loadRows.length,
        loads_open: loadRows.filter((l: any) => l.status === 'pending' && !l.carrier_org_id).length,
        loads_awarded: loadRows.filter((l: any) => !!l.carrier_org_id).length,
        invoices: (invoices.data ?? []).length,
        last_load_at: (loadRows[0] as any)?.created_at ?? null,
      },
    };
  },

  /** The platform asks a vendor whose KYC is waiting for more information. The KYC moves to 'info_requested'. */
  async requestInfo(vendorId: string, input: { message?: string; items: { label: string; kind: 'text' | 'document'; hint?: string }[] }, actor: AuditActor) {
    const { data: profile, error } = await supabase.from('vendor_profiles').select('id, company_name, kyc_status').eq('id', vendorId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) throw new HttpError(404, 'Vendor not found');
    if (profile.kyc_status !== 'submitted') {
      throw new HttpError(409, 'Information can be requested only while the KYC is waiting for review');
    }
    const items: InfoItem[] = input.items.map((it, i) => ({
      key: `${it.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item'}_${i + 1}`,
      label: it.label, kind: it.kind, hint: it.hint ?? null,
    }));

    // Only a KYC still 'submitted' moves, so two reviewers cannot both ask
    const { data: moved, error: moveErr } = await supabase.from('vendor_profiles')
      .update({ kyc_status: 'info_requested', updated_at: new Date().toISOString() })
      .eq('id', vendorId).eq('kyc_status', 'submitted').select('id').maybeSingle();
    if (moveErr) throw new Error(moveErr.message);
    if (!moved) throw new HttpError(409, 'Information can be requested only while the KYC is waiting for review');

    const { data: row, error: insErr } = await supabase.from('kyc_info_requests').insert({
      id: crypto.randomUUID(), vendor_id: vendorId, message: input.message || null, items, status: 'open', requested_by: actor.user_id,
    }).select('id, message, items, status, requested_at, answered_at, answers').single();
    if (insErr) {
      await supabase.from('vendor_profiles').update({ kyc_status: 'submitted' }).eq('id', vendorId).eq('kyc_status', 'info_requested');
      throw new Error(insErr.message);
    }

    invalidateOrgContext(vendorId);
    try {
      await notificationService.sendNotification(
        vendorId,
        'More information needed for your KYC',
        input.message ? `We need a few more details to verify your company: ${input.message}` : 'We need a few more details to verify your company. Open your company page to answer.',
        'kyc_info_requested',
        { vendor_id: vendorId, request_id: row.id },
      );
    } catch (e) {
      console.error('[vendor-review] info request notification failed:', e);
    }
    await auditService.record('staff-console', actor, 'kyc_info_requested', {
      vendor_id: vendorId, company_name: profile.company_name, request_id: row.id, message: input.message ?? null, items: items.map(i => i.label),
    });
    return row;
  },

  /** The vendor's open information requests. */
  async openRequests(vendorId: string) {
    const { data, error } = await supabase.from('kyc_info_requests')
      .select('id, message, items, status, requested_at')
      .eq('vendor_id', vendorId).eq('status', 'open').order('requested_at', { ascending: false });
    if (error) throw new Error(`Failed to read requests: ${error.message}`);
    return data ?? [];
  },

  /** The vendor answers every item of one request; the KYC goes back to 'submitted' for the platform. */
  async respond(vendorId: string, requestId: string, answers: InfoAnswer[]) {
    const { data: request, error } = await supabase.from('kyc_info_requests')
      .select('id, items, status').eq('id', requestId).eq('vendor_id', vendorId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!request) throw new HttpError(404, 'Request not found');
    if (request.status !== 'open') throw new HttpError(409, 'This request has already been answered');

    const items = (request.items ?? []) as InfoItem[];
    const byKey = new Map(answers.map(a => [a.key, a]));
    const clean: InfoAnswer[] = [];
    for (const item of items) {
      const a = byKey.get(item.key);
      if (item.kind === 'document') {
        if (!a?.document_path) throw new HttpError(400, `Attach a file for "${item.label}"`);
        if (!isOwnKycPath(vendorId, a.document_path)) throw new HttpError(400, 'Documents must be files you uploaded here');
        clean.push({ key: item.key, document_path: a.document_path });
      } else {
        const text = a?.text?.trim();
        if (!text) throw new HttpError(400, `Answer "${item.label}"`);
        clean.push({ key: item.key, text });
      }
    }

    const { data: profile, error: pErr } = await supabase.from('vendor_profiles').select('company_name, kyc_status, kyc_data').eq('id', vendorId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new HttpError(404, 'Set up your company profile first');

    const kyc = (profile.kyc_data ?? {}) as Record<string, any>;
    const otherDocs = Array.isArray(kyc.otherDocs) ? [...kyc.otherDocs] : [];
    const extra = { ...((kyc.extra ?? {}) as Record<string, string>) };
    for (const item of items) {
      const a = clean.find(c => c.key === item.key)!;
      if (a.document_path) otherDocs.push({ name: item.label, path: a.document_path });
      else extra[item.label] = a.text!;
    }

    const now = new Date().toISOString();
    const { data: closed, error: closeErr } = await supabase.from('kyc_info_requests')
      .update({ status: 'answered', answered_at: now, answers: clean })
      .eq('id', requestId).eq('status', 'open').select('id').maybeSingle();
    if (closeErr) throw new Error(closeErr.message);
    if (!closed) throw new HttpError(409, 'This request has already been answered');

    const { error: saveErr } = await supabase.from('vendor_profiles').update({
      kyc_data: { ...kyc, otherDocs, extra },
      // an approved profile stays with its own review rules; only a KYC waiting on the vendor goes back to review
      ...(profile.kyc_status === 'info_requested' ? { kyc_status: 'submitted' } : {}),
      updated_at: now,
    }).eq('id', vendorId);
    if (saveErr) throw new Error(saveErr.message);

    invalidateOrgContext(vendorId);
    try {
      await notificationService.notifySuperAdmins('KYC information received', `${profile.company_name} answered your request and is waiting for review.`, 'kyc_submitted', { profile_id: vendorId });
    } catch (e) {
      console.error('[vendor-review] answer notification failed:', e);
    }
    await auditService.record('vendor-portal', { user_id: vendorId, role: 'vendor' }, 'kyc_info_answered', { vendor_id: vendorId, company_name: profile.company_name, request_id: requestId });
    return { success: true, request_id: requestId, kyc_status: profile.kyc_status === 'info_requested' ? 'submitted' : profile.kyc_status };
  },
};
