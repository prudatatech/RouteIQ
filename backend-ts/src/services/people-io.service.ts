/**
 * margixindia — Moving people in and reporting out: CSV import (a dry run first),
 * the people export and the expiring-documents export.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { selectIn } from './finance.service';
import { Actor, PERSON_ROLES } from './people-common';
import { DOC_LABELS, DocType, addDays, daysBetween, effectiveStatus, todayKey } from './people-docs.service';
import { checkNewPerson, createPerson, listPeopleAll } from './people.service';

export const IMPORT_MAX_ROWS = 200;

// ── CSV text ───────────────────────────────────────────────

/** Parses CSV text (quoted fields, doubled quotes, CRLF) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

/** A cell that a spreadsheet would run as a formula is prefixed so it is shown as text. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const toCsv = (header: string[], rows: unknown[][]): string => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** The file part named `file` from a multipart/form-data body. */
export function extractMultipartFile(body: Buffer, contentType: string): string {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw new HttpError(400, 'Send the CSV as a file');
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let position = body.indexOf(delimiter);
  while (position !== -1) {
    const next = body.indexOf(delimiter, position + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(position + delimiter.length, next);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const headers = part.subarray(0, split).toString('utf8');
      if (/name="file"/i.test(headers)) return part.subarray(split + 4, part.length - 2).toString('utf8');
    }
    position = next;
  }
  throw new HttpError(400, 'Send the CSV as a file in the field "file"');
}

// ── Import ─────────────────────────────────────────────────

const HEADER_ALIASES: Record<string, string> = {
  name: 'full_name', full_name: 'full_name', fullname: 'full_name',
  role: 'role',
  phone: 'phone', mobile: 'phone', mobile_number: 'phone', phone_number: 'phone',
  email: 'email', email_address: 'email',
  employee_code: 'employee_code', employee_id: 'employee_code', emp_code: 'employee_code', code: 'employee_code',
  designation: 'designation', department: 'department',
  joining_date: 'date_of_joining', date_of_joining: 'date_of_joining', doj: 'date_of_joining',
};

function toIsoDate(raw: string): string {
  const v = raw.trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : v;
}

export interface ImportRow {
  row: number;
  name: string | null;
  status: 'ok' | 'error' | 'duplicate';
  errors?: string[];
  duplicate_of?: { id: string; full_name: string | null } | null;
  id?: string;
}

export interface ImportReport { dry_run: boolean; total: number; rows: ImportRow[]; created?: number }

/**
 * Checks every row of a CSV (name, role, phone, email, employee code, designation,
 * department, joining date) and, when `commit` is true, creates the rows that passed.
 * Staff rows send an invitation, exactly like adding them one by one.
 */
export async function importPeople(actor: Actor, csv: string, commit: boolean): Promise<ImportReport> {
  const table = parseCsv(csv);
  if (table.length < 2) throw new HttpError(400, 'The file needs a header row and at least one person');
  if (table.length - 1 > IMPORT_MAX_ROWS) throw new HttpError(400, `Import at most ${IMPORT_MAX_ROWS} people at a time`);
  const header = table[0].map(h => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null);
  if (!header.includes('full_name') || !header.includes('role')) throw new HttpError(400, 'The header row needs name and role columns');

  const seen = { phone: new Map<string, number>(), email: new Map<string, number>(), code: new Map<string, number>() };
  const rows: ImportRow[] = [];
  const valid: Array<{ index: number; body: Record<string, any> }> = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const fields: Record<string, string> = {};
    header.forEach((key, col) => { if (key && (cells[col] ?? '').trim()) fields[key] = cells[col].trim(); });
    const result: ImportRow = { row: i + 1, name: fields.full_name ?? null, status: 'ok' };
    try {
      const role = (fields.role ?? '').toLowerCase();
      if (!(PERSON_ROLES as readonly string[]).includes(role)) throw new HttpError(400, `role must be one of ${PERSON_ROLES.join(', ')}`);
      const body: Record<string, any> = {
        role, full_name: fields.full_name, phone: fields.phone, email: fields.email,
        profile: {
          ...(fields.employee_code ? { employee_code: fields.employee_code } : {}),
          ...(fields.designation ? { designation: fields.designation } : {}),
          ...(fields.department ? { department: fields.department } : {}),
          ...(fields.date_of_joining ? { date_of_joining: toIsoDate(fields.date_of_joining) } : {}),
        },
      };
      const checked = await checkNewPerson(actor, body);
      const clash = (map: Map<string, number>, key: string | null | undefined, label: string) => {
        if (!key) return;
        const earlier = map.get(key);
        if (earlier) throw new HttpError(400, `${label} is also used on row ${earlier}`);
        map.set(key, i + 1);
      };
      clash(seen.phone, checked.phone, 'This phone number');
      clash(seen.email, checked.email, 'This email');
      clash(seen.code, (checked.profilePatch.employee_code as string | undefined) ?? null, 'This employee code');
      valid.push({ index: rows.length, body });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      const existing = (e.extra?.existing_person as { id: string; full_name: string | null } | undefined) ?? null;
      result.status = e.status === 409 && existing ? 'duplicate' : 'error';
      result.errors = [e.message];
      if (existing) result.duplicate_of = { id: existing.id, full_name: existing.full_name };
    }
    rows.push(result);
  }

  if (!commit) return { dry_run: true, total: rows.length, rows };

  let created = 0;
  for (const item of valid) {
    try {
      const detail = await createPerson(actor, item.body);
      rows[item.index].id = detail.user.id;
      created += 1;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      rows[item.index].status = 'error';
      rows[item.index].errors = [e.message];
    }
  }
  return { dry_run: false, total: rows.length, rows, created };
}

// ── Exports ────────────────────────────────────────────────

/** A timestamp as an Indian date and time (YYYY-MM-DD HH:mm IST), or empty. */
export function istStamp(iso: unknown): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? `${new Date(t + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ')} IST` : '';
}

/** People and where their documents stand, as CSV. No bank or identity numbers. */
export async function exportPeopleCsv(): Promise<string> {
  const people = await listPeopleAll({});
  const profiles = await selectIn<any>('user_profiles', 'user_id', people.map(p => p.id as string), 'user_id, department, date_of_joining');
  const byId = new Map(profiles.map(p => [p.user_id, p]));
  return toCsv(
    ['Name', 'Role', 'Status', 'Phone', 'Email', 'Employee code', 'Designation', 'Department', 'Date of joining', 'Vehicle', 'Documents required', 'Verified', 'Pending', 'Expiring', 'Expired', 'Missing', 'Last sign-in'],
    people.map(p => {
      const profile = byId.get(p.id);
      return [p.full_name, p.role, p.status, p.phone, p.email, p.employee_code, p.designation, profile?.department, profile?.date_of_joining, p.vehicle_plate,
        p.doc_summary.required, p.doc_summary.verified, p.doc_summary.pending, p.doc_summary.expiring, p.doc_summary.expired, p.doc_summary.missing, istStamp(p.last_login)];
    }),
  );
}

/** Live documents that expire within `days` (or already have), soonest first. */
export async function expiringDocumentsCsv(days: number): Promise<string> {
  const today = todayKey();
  const horizon = addDays(today, days);
  const { data, error } = await supabase.from('user_documents')
    .select('id, user_id, doc_type, number_last4, expires_on, status, archived_at').is('archived_at', null).lte('expires_on', horizon);
  if (error) throw new Error(`Failed to read documents: ${error.message}`);
  const docs = (data ?? []).filter(d => d.expires_on && d.expires_on <= horizon && !d.archived_at && d.status !== 'rejected');
  const people = await selectIn<any>('users', 'id', docs.map(d => d.user_id), 'id, full_name, role, status, phone');
  const byId = new Map(people.map(p => [p.id, p]));
  const rows = docs
    .filter(d => byId.has(d.user_id) && (PERSON_ROLES as readonly string[]).includes(byId.get(d.user_id).role) && byId.get(d.user_id).status !== 'inactive')
    .sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)))
    .map(d => {
      const p = byId.get(d.user_id);
      return [p.full_name, p.role, p.phone, DOC_LABELS[d.doc_type as DocType] ?? d.doc_type, d.number_last4 ? `ending ${d.number_last4}` : '', d.expires_on, daysBetween(today, d.expires_on), effectiveStatus(d, today)];
    });
  return toCsv(['Name', 'Role', 'Phone', 'Document', 'Number', 'Expires on', 'Days left', 'Status'], rows);
}
