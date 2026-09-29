/**
 * margixindia — The daily people job (run once per Indian calendar day by the scheduler).
 *
 *  1. Documents past `expires_on` become `expired`. Staff get one digest
 *     ("3 licences expire this week") instead of a message per document; a
 *     driver still gets their own reminder. Each reminder (30 days, 7 days, the
 *     day) is sent once, recorded in `metadata.reminders_sent`. A `review_by`
 *     date works the same way but never expires the document.
 *  2. Leave and suspensions that have ended return the person to active.
 *  3. People who left more than `document_retention_days` ago lose their
 *     document files; the record, dates and verification history stay.
 * Every step only touches rows that are still waiting, so a second run, or two
 * servers running at once, does no harm.
 */
import { supabase } from '../core/supabase';
import { invalidateRoleCache } from '../core/auth';
import { selectIn } from './finance.service';
import { notificationService } from './notification.service';
import { DOC_LABELS, DocRow, DocType, EXPIRING_WITHIN_DAYS, daysBetween, todayKey, addDays } from './people-docs.service';
import { getPeopleSettings } from './people-settings.service';
import { PERSON_ROLES, logActivity, nowIso, removeStoredFiles } from './people-common';
import { setSignInBan } from './people.service';

type Marker = 'd30' | 'd7' | 'd0';

export interface ExpiryJobResult { expired: number; reminders: number; digest_sent: boolean }

function markerFor(days: number): Marker | null {
  if (days > EXPIRING_WITHIN_DAYS) return null;
  if (days > 7) return 'd30';
  if (days > 0) return 'd7';
  return 'd0';
}

const phrase = (days: number, review: boolean) => {
  const what = review ? 'is due for review' : 'expires';
  if (days < 0) return review ? 'is overdue for review' : 'has expired';
  if (days === 0) return `${what} today`;
  if (days === 1) return `${what} tomorrow`;
  return `${what} in ${days} days`;
};

interface Fired { user_id: string; doc_id: string; kind: 'expired' | 'week' | 'month' | 'review' }

export async function runDocumentExpiryJob(now = new Date()): Promise<ExpiryJobResult> {
  const today = todayKey(now);
  const horizon = addDays(today, EXPIRING_WITHIN_DAYS);
  const [byExpiry, byReview] = await Promise.all([
    supabase.from('user_documents').select('id, user_id, doc_type, status, expires_on, review_by, metadata').is('archived_at', null).in('status', ['pending', 'verified']).lte('expires_on', horizon),
    supabase.from('user_documents').select('id, user_id, doc_type, status, expires_on, review_by, metadata').is('archived_at', null).in('status', ['pending', 'verified']).lte('review_by', horizon),
  ]);
  if (byExpiry.error) throw new Error(`Failed to read documents: ${byExpiry.error.message}`);
  if (byReview.error) throw new Error(`Failed to read documents: ${byReview.error.message}`);

  const docs = new Map<string, DocRow>();
  for (const d of [...(byExpiry.data ?? []), ...(byReview.data ?? [])] as DocRow[]) {
    if ((d.expires_on && d.expires_on <= horizon) || (d.review_by && d.review_by <= horizon)) docs.set(d.id, d);
  }
  if (docs.size === 0) return { expired: 0, reminders: 0, digest_sent: false };

  const people = await selectIn<{ id: string; full_name: string | null; role: string; is_active: boolean }>(
    'users', 'id', [...docs.values()].map(d => d.user_id), 'id, full_name, role, is_active');
  const personById = new Map(people.map(p => [p.id, p]));

  let expired = 0;
  const fired: Fired[] = [];
  const updates: Array<{ id: string; patch: Record<string, unknown>; markers: boolean }> = [];
  const driverMessages: Array<{ userId: string; title: string; body: string; docId: string }> = [];

  for (const doc of docs.values()) {
    const person = personById.get(doc.user_id);
    if (!person || !person.is_active) continue;
    const label = DOC_LABELS[doc.doc_type as DocType] ?? 'Document';
    const sent: Record<string, string> = { ...((doc.metadata?.reminders_sent as Record<string, string> | undefined) ?? {}) };
    const patch: Record<string, unknown> = {};
    let markersChanged = false;
    const stamp = now.toISOString();

    const events: Array<{ date: string; prefix: string; review: boolean }> = [];
    if (doc.expires_on && doc.expires_on <= horizon) events.push({ date: doc.expires_on, prefix: '', review: false });
    if (doc.review_by && doc.review_by <= horizon && !(doc.expires_on && doc.expires_on < today)) events.push({ date: doc.review_by, prefix: 'review_', review: true });

    for (const event of events) {
      const days = daysBetween(today, event.date);
      if (days < 0 && !event.review) {
        patch.status = 'expired';
        expired += 1;
      }
      const marker = days < 0 ? 'd0' : markerFor(days);
      if (!marker) continue;
      const key = `${event.prefix}${marker}`;
      if (sent[key]) continue;
      sent[key] = stamp;
      if (marker === 'd0') { sent[`${event.prefix}d7`] ??= stamp; sent[`${event.prefix}d30`] ??= stamp; }
      if (marker === 'd7') sent[`${event.prefix}d30`] ??= stamp;
      markersChanged = true;
      fired.push({
        user_id: doc.user_id,
        doc_id: doc.id,
        kind: event.review ? 'review' : days <= 0 ? 'expired' : days <= 7 ? 'week' : 'month',
      });
      if (person.role === 'driver') {
        const verb = event.review ? 'needs review' : days < 0 ? 'has expired' : 'is expiring';
        driverMessages.push({
          userId: doc.user_id,
          title: `Your ${label.toLowerCase()} ${verb}`,
          body: `Your ${label.toLowerCase()} ${phrase(days, event.review)}. Upload the renewed one in Profile, My documents.`,
          docId: doc.id,
        });
      }
    }
    if (markersChanged) patch.metadata = { ...(doc.metadata ?? {}), reminders_sent: sent };
    if (Object.keys(patch).length > 0) updates.push({ id: doc.id, patch, markers: markersChanged });
  }

  // One digest for staff. If it can't be sent the reminders stay unmarked and are tried again next run.
  let digestSent = false;
  if (fired.length > 0) {
    const count = (kind: Fired['kind']) => fired.filter(f => f.kind === kind).length;
    const parts = [
      count('expired') ? `${count('expired')} document${count('expired') === 1 ? '' : 's'} expired` : '',
      count('week') ? `${count('week')} expire${count('week') === 1 ? 's' : ''} within 7 days` : '',
      count('month') ? `${count('month')} expire${count('month') === 1 ? 's' : ''} within 30 days` : '',
      count('review') ? `${count('review')} need${count('review') === 1 ? 's' : ''} review` : '',
    ].filter(Boolean);
    const single = fired.length === 1 ? { user_id: fired[0].user_id, doc_id: fired[0].doc_id } : {};
    try {
      await notificationService.notifyStaff('Documents need attention', `${parts.join(', ')}.`, 'document_expiring', {
        ...single, items: fired.slice(0, 50).map(f => ({ user_id: f.user_id, doc_id: f.doc_id })), counts: { expired: count('expired'), week: count('week'), month: count('month'), review: count('review') },
      });
      digestSent = true;
    } catch (e: any) {
      console.error('[people-jobs] digest failed:', e.message);
    }
  }
  for (const m of driverMessages) {
    try {
      await notificationService.sendNotification(m.userId, m.title, m.body, 'document_expiring', { user_id: m.userId, doc_id: m.docId });
    } catch (e: any) {
      console.error('[people-jobs] driver reminder failed:', e.message);
    }
  }

  for (const u of updates) {
    const patch: Record<string, unknown> = { ...u.patch, updated_at: nowIso() };
    if (u.markers && fired.length > 0 && !digestSent) delete patch.metadata;
    const { error } = await supabase.from('user_documents').update(patch).eq('id', u.id);
    if (error) console.error('[people-jobs] could not update document:', error.message);
  }
  return { expired, reminders: fired.length, digest_sent: digestSent };
}

// ── Leave and suspensions that have ended ──────────────────

export async function returnFromLeaveAndSuspension(now = new Date()): Promise<number> {
  const today = todayKey(now);
  const { data: profiles, error } = await supabase.from('user_profiles').select('user_id, leave_until, suspended_until').or('leave_until.not.is.null,suspended_until.not.is.null');
  if (error) throw new Error(`Failed to read profiles: ${error.message}`);
  const candidates = (profiles ?? []).filter(p => (p.leave_until && p.leave_until < today) || (p.suspended_until && p.suspended_until < today));
  if (candidates.length === 0) return 0;

  const people = await selectIn<{ id: string; full_name: string | null; status: string; role: string }>(
    'users', 'id', candidates.map(p => p.user_id), 'id, full_name, status, role');
  const returned: string[] = [];
  for (const profile of candidates) {
    const person = people.find(p => p.id === profile.user_id);
    if (!person || !(PERSON_ROLES as readonly string[]).includes(person.role)) continue;
    const backFromLeave = person.status === 'on_leave' && profile.leave_until && profile.leave_until < today;
    const backFromSuspension = person.status === 'suspended' && profile.suspended_until && profile.suspended_until < today;
    if (!backFromLeave && !backFromSuspension) continue;
    const reason = backFromLeave ? 'Leave ended' : 'Suspension ended';
    await supabase.from('users').update({ status: 'active', is_active: true, updated_at: nowIso() }).eq('id', person.id);
    await supabase.from('user_profiles').update({ leave_from: null, leave_until: null, suspended_until: null, updated_at: nowIso() }).eq('user_id', person.id);
    await supabase.from('user_status_history').insert({ user_id: person.id, from_status: person.status, to_status: 'active', reason, changed_by: null, created_at: nowIso() });
    await logActivity(person.id, null, 'status_changed', { from: person.status, to: 'active', reason, automatic: true });
    invalidateRoleCache(person.id);
    if (backFromSuspension) await setSignInBan(person.id, false);
    returned.push(`${person.full_name ?? 'A team member'} (${reason.toLowerCase()})`);
  }
  if (returned.length > 0) {
    try {
      await notificationService.notifyStaff('People back at work', `${returned.join(', ')}. They are active again.`, 'people_status', { count: returned.length });
    } catch (e: any) {
      console.error('[people-jobs] could not notify about returns:', e.message);
    }
  }
  return returned.length;
}

// ── Retention ──────────────────────────────────────────────

/** Deletes the document files of people who left more than `document_retention_days` ago. Returns how many documents were purged. */
export async function purgeDocumentsAfterRetention(now = new Date()): Promise<number> {
  const today = todayKey(now);
  const { document_retention_days } = await getPeopleSettings();
  const { data: gone, error } = await supabase.from('users').select('id, updated_at, created_at').in('role', [...PERSON_ROLES]).eq('status', 'inactive');
  if (error) throw new Error(`Failed to read people: ${error.message}`);
  if (!gone || gone.length === 0) return 0;

  const history = await selectIn<any>('user_status_history', 'user_id', gone.map(g => g.id), 'user_id, to_status, created_at', q => q.eq('to_status', 'inactive'));
  let purged = 0;
  for (const person of gone) {
    const times = history.filter(h => h.user_id === person.id).map(h => Date.parse(h.created_at)).filter(Number.isFinite);
    const left = new Date(times.length ? Math.max(...times) : Date.parse(person.updated_at ?? person.created_at ?? nowIso())).toISOString().slice(0, 10);
    if (daysBetween(left, today) <= document_retention_days) continue;

    const { data: docs } = await supabase.from('user_documents').select('id, file_path, extra_file_paths, metadata').eq('user_id', person.id);
    const withFiles = (docs ?? []).filter(d => d.file_path || (d.extra_file_paths ?? []).length);
    const { data: profile } = await supabase.from('user_profiles').select('photo_path').eq('user_id', person.id).maybeSingle();
    if (withFiles.length === 0 && !profile?.photo_path) continue;

    await removeStoredFiles([...withFiles.flatMap(d => [d.file_path, ...((d.extra_file_paths ?? []) as string[])]), profile?.photo_path]);
    for (const d of withFiles) {
      await supabase.from('user_documents').update({
        file_path: null, extra_file_paths: null, archived_at: nowIso(), updated_at: nowIso(),
        metadata: { ...(d.metadata ?? {}), retention_purged_at: nowIso() },
      }).eq('id', d.id);
    }
    if (profile?.photo_path) await supabase.from('user_profiles').update({ photo_path: null, updated_at: nowIso() }).eq('user_id', person.id);
    await logActivity(person.id, null, 'documents_purged', { documents: withFiles.length, retention_days: document_retention_days, left_on: left });
    purged += withFiles.length;
  }
  return purged;
}

export interface DailyJobResult { expiry: ExpiryJobResult | null; returned: number; purged: number; failed: string[] }

/** One daily pass. A failing step is reported and does not stop the others. */
export async function runPeopleDailyJob(now = new Date()): Promise<DailyJobResult> {
  const result: DailyJobResult = { expiry: null, returned: 0, purged: 0, failed: [] };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e: any) {
      result.failed.push(name);
      console.error(`[people-jobs] ${name} failed:`, e.message);
    }
  };
  await step('document expiry', async () => { result.expiry = await runDocumentExpiryJob(now); });
  await step('leave and suspension', async () => { result.returned = await returnFromLeaveAndSuspension(now); });
  await step('document retention', async () => { result.purged = await purgeDocumentsAfterRetention(now); });
  return result;
}
