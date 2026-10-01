/**
 * margixindia — Emergency contacts, staff notes, and bank and payout details.
 *
 * Bank details are the most sensitive part of a profile: only admins see them
 * (masked to the last four digits), only a superadmin can reveal a full number
 * and every reveal is logged. A change is announced to the person and every
 * superadmin, and the new account is used for payouts only after a cooling
 * period (bank_change_cooldown_hours). Drivers employed by a partner have no
 * bank details here: the partner pays them.
 */
import { checkIfscForSave, type IfscCheck } from './ifsc.service';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { normalizePhone } from '../utils/phone';
import {
  isAccountNumber, isIfscFormat, isUpiId, maskAccountNumber, normalizeAccountNumber, normalizeIfsc, sameName,
} from '../utils/people-validators';
import { notificationService } from './notification.service';
import {
  Actor, PersonRow, assertCanModify, assertFresh, canManage, isUuid, last4, logActivity, nowIso, parseRequiredText,
  superadminIds, withWarnings,
} from './people-common';
import { getPeopleSettings } from './people-settings.service';
import { getProfile } from './people-profile.service';

// ── Emergency contacts ─────────────────────────────────────

const MAX_CONTACTS = 5;

export async function listContacts(userId: string): Promise<Array<Record<string, any>>> {
  const { data, error } = await supabase.from('user_emergency_contacts').select('*').eq('user_id', userId);
  if (error) throw new Error(`Failed to read contacts: ${error.message}`);
  return (data ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || String(a.created_at).localeCompare(String(b.created_at)));
}

function contactFields(body: Record<string, any>, partial: boolean): Record<string, any> {
  const out: Record<string, any> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('name')) out.name = parseRequiredText(body.name, 'Name', 100, 2);
  if (!partial || has('phone')) {
    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, 'Phone is not a valid phone number');
    out.phone = phone;
  }
  if (has('relation')) out.relation = body.relation ? parseRequiredText(body.relation, 'Relation', 50) : null;
  if (has('is_primary')) {
    if (typeof body.is_primary !== 'boolean') throw new HttpError(400, 'is_primary must be true or false');
    out.is_primary = body.is_primary;
  }
  return out;
}

async function clearOtherPrimaries(userId: string, exceptId: string): Promise<void> {
  await supabase.from('user_emergency_contacts').update({ is_primary: false, updated_at: nowIso() }).eq('user_id', userId).eq('is_primary', true).neq('id', exceptId);
}

export async function createContact(actor: Actor, subject: PersonRow, body: Record<string, any>) {
  const existing = await listContacts(subject.id);
  if (existing.length >= MAX_CONTACTS) throw new HttpError(409, `At most ${MAX_CONTACTS} emergency contacts`);
  const fields = contactFields(body, false);
  const primary = fields.is_primary === true || existing.length === 0;
  const { data, error } = await supabase.from('user_emergency_contacts')
    .insert({ user_id: subject.id, ...fields, is_primary: primary, created_at: nowIso(), updated_at: nowIso() }).select().single();
  if (error || !data) throw new Error(`Failed to save contact: ${error?.message}`);
  if (primary) await clearOtherPrimaries(subject.id, data.id);
  await logActivity(subject.id, actor.user_id, 'contact_added', { contact_id: data.id, name: data.name });
  return data;
}

async function loadContact(userId: string, contactId: string) {
  if (!isUuid(contactId)) throw new HttpError(404, 'Contact not found');
  const { data, error } = await supabase.from('user_emergency_contacts').select('*').eq('id', contactId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Failed to read contact: ${error.message}`);
  if (!data) throw new HttpError(404, 'Contact not found');
  return data;
}

export async function updateContact(actor: Actor, subject: PersonRow, contactId: string, body: Record<string, any>) {
  const contact = await loadContact(subject.id, contactId);
  assertFresh(contact.updated_at, body.updated_at);
  const fields = contactFields(body, true);
  if (Object.keys(fields).length === 0) throw new HttpError(400, 'Nothing to update');
  if (fields.is_primary === false && contact.is_primary) throw new HttpError(409, 'Make another contact the primary one instead');
  const { data, error } = await supabase.from('user_emergency_contacts').update({ ...fields, updated_at: nowIso() }).eq('id', contact.id).select().single();
  if (error || !data) throw new Error(`Failed to update contact: ${error?.message}`);
  if (fields.is_primary) await clearOtherPrimaries(subject.id, contact.id);
  await logActivity(subject.id, actor.user_id, 'contact_updated', { contact_id: contact.id, fields: Object.keys(fields) });
  return data;
}

export async function deleteContact(actor: Actor, subject: PersonRow, contactId: string): Promise<void> {
  const contact = await loadContact(subject.id, contactId);
  const { error } = await supabase.from('user_emergency_contacts').delete().eq('id', contact.id);
  if (error) throw new Error(`Failed to delete contact: ${error.message}`);
  if (contact.is_primary) {
    const [next] = await listContacts(subject.id);
    if (next) await supabase.from('user_emergency_contacts').update({ is_primary: true, updated_at: nowIso() }).eq('id', next.id);
  }
  await logActivity(subject.id, actor.user_id, 'contact_removed', { contact_id: contact.id, name: contact.name });
}

// ── Notes ──────────────────────────────────────────────────

export async function listNotes(userId: string): Promise<Array<Record<string, any>>> {
  const { data, error } = await supabase.from('user_notes').select('*').eq('user_id', userId);
  if (error) throw new Error(`Failed to read notes: ${error.message}`);
  const notes = (data ?? []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const authorIds = [...new Set(notes.map(n => n.author_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (authorIds.length) {
    const { data: authors } = await supabase.from('users').select('id, full_name').in('id', authorIds);
    for (const a of authors ?? []) names.set(a.id, a.full_name ?? '');
  }
  return notes.map(n => ({ ...n, author_name: names.get(n.author_id) ?? null }));
}

export async function createNote(actor: Actor, subject: PersonRow, body: Record<string, any>) {
  const text = parseRequiredText(body.body, 'Note', 2000);
  const { data, error } = await supabase.from('user_notes').insert({ user_id: subject.id, body: text, author_id: actor.user_id, created_at: nowIso() }).select().single();
  if (error || !data) throw new Error(`Failed to save note: ${error?.message}`);
  await logActivity(subject.id, actor.user_id, 'note_added', { note_id: data.id });
  const { data: author } = await supabase.from('users').select('full_name').eq('id', actor.user_id).maybeSingle();
  return { ...data, author_name: author?.full_name ?? null };
}

// ── Bank and payout ────────────────────────────────────────

/** Admins only; a superadmin's bank details only by a superadmin; none for partner-employed drivers. */
export async function assertBankAccess(actor: Actor, subject: PersonRow): Promise<void> {
  if (!canManage(actor)) throw new HttpError(403, 'Not authorized for this action');
  assertCanModify(actor, subject);
  const profile = await getProfile(subject.id);
  if (profile?.employer_type === 'partner') throw new HttpError(409, "This driver works for a partner, who pays them. There are no bank details to keep here", { code: 'partner_paid' });
}

export function serializeBank(row: Record<string, any>, personName: string | null): Record<string, any> {
  const { account_number, ...rest } = row;
  return {
    ...rest,
    account_number: maskAccountNumber(account_number),
    account_last4: last4(account_number),
    active_for_payout: !row.effective_from || Date.parse(row.effective_from) <= Date.now(),
    name_mismatch: !sameName(row.account_holder, personName),
  };
}

const istDate = (iso: string): string => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

export interface PayoutAccount {
  id: string;
  account_holder: string;
  bank_name: string | null;
  account_number: string | null;
  account_last4: string | null;
  ifsc: string | null;
  upi_id: string | null;
  is_verified: boolean;
  effective_from: string | null;
  /** Set while a newer primary account is still in its cooling period. */
  note: string | null;
  pending_from: string | null;
}

/**
 * The account payouts go to at time `at`: the primary account once its
 * `effective_from` has passed. While a new primary is still cooling, the
 * previous account that was already in effect keeps receiving payouts and the
 * result carries the note "New details active from <date>". Null when the
 * person has no usable account or is paid by a partner. Masked: safe to show
 * to the driver.
 */
export async function getPayoutAccount(userId: string, at: Date = new Date()): Promise<PayoutAccount | null> {
  // Independent reads; a partner's accounts are simply not used
  const [profile, { data, error }] = await Promise.all([
    getProfile(userId),
    supabase.from('user_bank_accounts').select('*').eq('user_id', userId),
  ]);
  if (profile?.employer_type === 'partner') return null;
  if (error) throw new Error(`Failed to read bank accounts: ${error.message}`);
  const rows = data ?? [];
  const inEffect = (r: Record<string, any>) => !r.effective_from || Date.parse(r.effective_from) <= at.getTime();
  const primary = rows.find(r => r.is_primary);
  let chosen: Record<string, any> | undefined;
  let pendingFrom: string | null = null;
  if (primary && inEffect(primary)) {
    chosen = primary;
  } else {
    if (primary) pendingFrom = primary.effective_from;
    chosen = rows.filter(r => r !== primary && inEffect(r)).sort((a, b) => String(b.effective_from ?? b.created_at).localeCompare(String(a.effective_from ?? a.created_at)))[0];
  }
  if (!chosen) return null;
  return {
    id: chosen.id,
    account_holder: chosen.account_holder,
    bank_name: chosen.bank_name ?? null,
    account_number: maskAccountNumber(chosen.account_number),
    account_last4: last4(chosen.account_number),
    ifsc: chosen.ifsc ?? null,
    upi_id: chosen.upi_id ?? null,
    is_verified: !!chosen.is_verified,
    effective_from: chosen.effective_from ?? null,
    note: pendingFrom ? `New details active from ${istDate(pendingFrom)}` : null,
    pending_from: pendingFrom,
  };
}

export async function listBankAccounts(subject: PersonRow): Promise<Array<Record<string, any>>> {
  const { data, error } = await supabase.from('user_bank_accounts').select('*').eq('user_id', subject.id);
  if (error) throw new Error(`Failed to read bank accounts: ${error.message}`);
  return (data ?? [])
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || String(a.created_at).localeCompare(String(b.created_at)))
    .map(a => serializeBank(a, subject.full_name));
}

async function checkProof(userId: string, value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null;
  if (!isUuid(value)) throw new HttpError(400, 'proof_document_id must be a document of this person');
  const { data } = await supabase.from('user_documents').select('id').eq('id', value).eq('user_id', userId).eq('doc_type', 'bank_proof').is('archived_at', null).maybeSingle();
  if (!data) throw new HttpError(400, 'proof_document_id must be a bank proof uploaded for this person');
  return value;
}

/** Tells the person and every superadmin (except the one who made the change) that bank details changed. */
async function announceBankChange(actor: Actor, subject: PersonRow, what: string, effectiveFrom: string | null): Promise<void> {
  const recipients = new Set<string>([subject.id, ...(await superadminIds())]);
  recipients.delete(actor.user_id);
  const when = effectiveFrom && Date.parse(effectiveFrom) > Date.now() ? ` The new details are used for payouts from ${effectiveFrom.slice(0, 16).replace('T', ' ')} UTC.` : '';
  for (const id of recipients) {
    try {
      await notificationService.sendNotification(
        id,
        'Bank details changed',
        `Bank details for ${subject.full_name ?? 'a team member'} were ${what}.${when} If this wasn't expected, tell an admin.`,
        'bank_details_changed',
        { user_id: subject.id },
      );
    } catch (e: any) {
      console.error('[people] could not announce a bank change:', e.message);
    }
  }
}

function bankFields(body: Record<string, any>, partial: boolean): Record<string, any> {
  const out: Record<string, any> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('account_holder')) out.account_holder = parseRequiredText(body.account_holder, 'Account holder', 100, 2);
  if (!partial || has('account_number')) {
    if (!isAccountNumber(body.account_number)) throw new HttpError(400, 'Account number must be 9 to 18 digits');
    out.account_number = normalizeAccountNumber(body.account_number);
  }
  if (!partial || has('ifsc')) {
    if (!isIfscFormat(body.ifsc)) throw new HttpError(400, 'IFSC must be 4 letters, a zero and 6 letters or digits (for example HDFC0001234)');
    out.ifsc = normalizeIfsc(body.ifsc);
  }
  if (has('bank_name')) out.bank_name = body.bank_name ? parseRequiredText(body.bank_name, 'Bank name', 100) : null;
  if (has('upi_id')) {
    if (body.upi_id && !isUpiId(body.upi_id)) throw new HttpError(400, 'UPI ID must look like name@bank');
    out.upi_id = body.upi_id ? String(body.upi_id).trim() : null;
  }
  if (has('is_primary')) {
    if (typeof body.is_primary !== 'boolean') throw new HttpError(400, 'is_primary must be true or false');
    out.is_primary = body.is_primary;
  }
  return out;
}

/** Columns filled from a branch lookup; all null when the lookup was down. */
function ifscColumns(check: IfscCheck): Record<string, any> {
  const d = check.details;
  return {
    bank_name: d?.bank ?? undefined,
    branch_name: d?.branch ?? null, bank_address: d?.address ?? null, bank_city: d?.city ?? null,
    bank_state: d?.state ?? null, micr: d?.micr ?? null, ifsc_details: d ?? null, ifsc_verified_at: check.verifiedAt,
  };
}

async function clearOtherBankPrimaries(userId: string, exceptId: string): Promise<void> {
  await supabase.from('user_bank_accounts').update({ is_primary: false, updated_at: nowIso() }).eq('user_id', userId).eq('is_primary', true).neq('id', exceptId);
}

export async function createBankAccount(actor: Actor, subject: PersonRow, body: Record<string, any>) {
  await assertBankAccess(actor, subject);
  const fields = bankFields(body, false);
  const ifscCheck = await checkIfscForSave(fields.ifsc);
  Object.assign(fields, dropUndefined(ifscColumns(ifscCheck)));
  const proof = await checkProof(subject.id, body.proof_document_id);
  const { data: existing } = await supabase.from('user_bank_accounts').select('id').eq('user_id', subject.id);
  const first = (existing ?? []).length === 0;
  const cooldown = (await getPeopleSettings()).bank_change_cooldown_hours;
  const effectiveFrom = first ? nowIso() : new Date(Date.now() + cooldown * 3_600_000).toISOString();
  const { data, error } = await supabase.from('user_bank_accounts').insert({
    user_id: subject.id, ...fields, is_primary: first || fields.is_primary === true, is_verified: false,
    effective_from: effectiveFrom, proof_document_id: proof, created_at: nowIso(), updated_at: nowIso(),
  }).select().single();
  if (error || !data) throw new Error(`Failed to save bank account: ${error?.message}`);
  if (data.is_primary) await clearOtherBankPrimaries(subject.id, data.id);
  await logActivity(subject.id, actor.user_id, 'bank_added', { account_id: data.id, account_last4: last4(data.account_number), effective_from: effectiveFrom });
  await announceBankChange(actor, subject, 'added', effectiveFrom);
  const out = serializeBank(data, subject.full_name);
  return withWarnings(out, [...(out.name_mismatch ? ['account_holder_mismatch'] : []), ...ifscCheck.warnings]);
}

async function loadBank(userId: string, accountId: string) {
  if (!isUuid(accountId)) throw new HttpError(404, 'Bank account not found');
  const { data, error } = await supabase.from('user_bank_accounts').select('*').eq('id', accountId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Failed to read bank account: ${error.message}`);
  if (!data) throw new HttpError(404, 'Bank account not found');
  return data;
}

export async function updateBankAccount(actor: Actor, subject: PersonRow, accountId: string, body: Record<string, any>) {
  await assertBankAccess(actor, subject);
  const account = await loadBank(subject.id, accountId);
  assertFresh(account.updated_at, body.updated_at);
  const fields = bankFields(body, true);
  const patch: Record<string, any> = { ...fields };
  let ifscCheck: IfscCheck | null = null;
  if ('ifsc' in fields && (fields.ifsc !== account.ifsc || !account.ifsc_verified_at)) {
    ifscCheck = await checkIfscForSave(fields.ifsc);
    Object.assign(patch, dropUndefined(ifscColumns(ifscCheck)));
  }
  const detailsChanged = ['account_holder', 'account_number', 'ifsc', 'upi_id'].some(k => k in fields && fields[k] !== account[k]);

  if (Object.prototype.hasOwnProperty.call(body, 'proof_document_id')) patch.proof_document_id = await checkProof(subject.id, body.proof_document_id);
  if (fields.is_primary === false && account.is_primary) throw new HttpError(409, 'Make another account the primary one instead');

  if (detailsChanged) {
    const cooldown = (await getPeopleSettings()).bank_change_cooldown_hours;
    patch.is_verified = false;
    patch.effective_from = new Date(Date.now() + cooldown * 3_600_000).toISOString();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'is_verified')) {
    if (typeof body.is_verified !== 'boolean') throw new HttpError(400, 'is_verified must be true or false');
    if (body.is_verified) {
      if (actor.user_id === subject.id) throw new HttpError(403, "You can't verify your own bank details");
      const holder = (patch.account_holder ?? account.account_holder) as string;
      if (!sameName(holder, subject.full_name)) {
        const note = typeof body.verification_note === 'string' ? body.verification_note.trim() : '';
        if (note.length < 3) throw new HttpError(409, `The account holder (${holder}) is not the person's name. Add a verification note to verify it`, { code: 'name_mismatch' });
        await logActivity(subject.id, actor.user_id, 'bank_name_mismatch_accepted', { account_id: account.id, note: note.slice(0, 300) });
      }
    }
    patch.is_verified = body.is_verified && !detailsChanged;
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to update');

  patch.updated_at = nowIso();
  const { data, error } = await supabase.from('user_bank_accounts').update(patch).eq('id', account.id).select().single();
  if (error || !data) throw new Error(`Failed to update bank account: ${error?.message}`);
  if (patch.is_primary) await clearOtherBankPrimaries(subject.id, account.id);
  await logActivity(subject.id, actor.user_id, 'bank_updated', {
    account_id: account.id, account_last4: last4(data.account_number),
    fields: [...Object.keys(fields), ...(patch.is_verified !== undefined ? ['is_verified'] : [])],
  });
  if (detailsChanged) await announceBankChange(actor, subject, 'changed', patch.effective_from);
  const out = serializeBank(data, subject.full_name);
  return withWarnings(out, [...(out.name_mismatch ? ['account_holder_mismatch'] : []), ...(ifscCheck?.warnings ?? [])]);
}

export async function deleteBankAccount(actor: Actor, subject: PersonRow, accountId: string): Promise<void> {
  await assertBankAccess(actor, subject);
  const account = await loadBank(subject.id, accountId);
  const { error } = await supabase.from('user_bank_accounts').delete().eq('id', account.id);
  if (error) throw new Error(`Failed to delete bank account: ${error.message}`);
  if (account.is_primary) {
    const [next] = await listBankAccounts(subject);
    if (next) await supabase.from('user_bank_accounts').update({ is_primary: true, updated_at: nowIso() }).eq('id', next.id);
  }
  await logActivity(subject.id, actor.user_id, 'bank_removed', { account_id: account.id, account_last4: last4(account.account_number) });
  await announceBankChange(actor, subject, 'removed', null);
}

/** The full account number, for a superadmin only, always logged. */
export async function revealBankAccount(actor: Actor, subject: PersonRow, accountId: string) {
  if (actor.role !== 'superadmin') throw new HttpError(403, 'Only a superadmin can view a full account number');
  await assertBankAccess(actor, subject);
  const account = await loadBank(subject.id, accountId);
  await logActivity(subject.id, actor.user_id, 'bank_reveal', { account_id: account.id, account_last4: last4(account.account_number) });
  return { id: account.id, account_number: account.account_number as string };
}

const dropUndefined = (o: Record<string, any>): Record<string, any> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
