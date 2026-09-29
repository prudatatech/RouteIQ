import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { getPayoutAccount } from '../src/services/people-bank.service';
import { purgeDocumentsAfterRetention, returnFromLeaveAndSuspension, runPeopleDailyJob } from '../src/services/people-jobs.service';

const app = testApp();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUPER = id(1), ADMIN = id(2), MGR = id(3), DRV = id(4), DRV2 = id(5), VEH = id(10);
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const superadmin = as(SUPER, 'superadmin');
const admin = as(ADMIN, 'admin');
const manager = as(MGR, 'manager');
const driver = as(DRV, 'driver');

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const STAFF = [SUPER, ADMIN, MGR];

function fixtures(extra: Record<string, any[]> = {}) {
  return {
    users: [
      { id: SUPER, role: 'superadmin', is_active: true, status: 'active', full_name: 'Sue Super' },
      { id: ADMIN, role: 'admin', is_active: true, status: 'active', full_name: 'Adam Admin', email: 'adam@x.in' },
      { id: MGR, role: 'manager', is_active: true, status: 'active', full_name: 'Mona Manager' },
      { id: DRV, role: 'driver', is_active: true, status: 'active', full_name: 'Ravi Kumar', phone: '+919876500001', last_login: '2026-09-28T20:30:00Z' },
      { id: DRV2, role: 'driver', is_active: true, status: 'active', full_name: 'Sunil Rao', phone: '+919876500002' },
    ],
    user_profiles: [
      { user_id: DRV, consent_at: '2026-09-01T00:00:00Z', consent_method: 'in_app', updated_at: '2026-09-01T00:00:00Z' },
      { user_id: DRV2, consent_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    ],
    user_documents: [], user_activity: [], user_status_history: [], user_phone_history: [], user_bank_accounts: [],
    user_emergency_contacts: [], user_notes: [], notifications: [], vehicles: [], routes: [], system_settings: [],
    driver_vehicle_assignments: [], route_stops: [], shipments: [], depots: [], tpl_partners: [], driver_confirmations: [],
    ...extra,
  };
}

beforeEach(() => {
  supabaseMock.reset(fixtures());
  supabaseMock.authAdmin = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const post = (who: object, target: string, body: object) => request(app).post(`/api/v1/people/${target}/status`).set(who).send(body);

describe('stop prompts when a driver stops working', () => {
  const withPrompts = () => supabaseMock.reset(fixtures({
    vehicles: [{ id: VEH, plate_number: 'KA01AB1234', driver_id: DRV, status: 'available' }],
    driver_confirmations: [
      { id: id(30), route_stop_id: id(40), vehicle_id: VEH, prompted_at: hoursFromNow(-1), delivered_at: null, responded_at: null, action: null },
      { id: id(31), route_stop_id: id(41), vehicle_id: VEH, prompted_at: hoursFromNow(-2), delivered_at: null, responded_at: hoursFromNow(-1), action: 'confirmed' },
      { id: id(32), route_stop_id: id(42), vehicle_id: id(11), prompted_at: hoursFromNow(-1), delivered_at: null, responded_at: null, action: null },
    ],
  }));

  it.each([['suspended', 'was suspended'], ['inactive', 'was deactivated']])('releases unanswered prompts on %s and tells staff', async (status, why) => {
    withPrompts();
    const res = await post(admin, DRV, { status, reason: 'Left the company', confirm_release: true });
    expect(res.status).toBe(200);
    const prompts = supabaseMock.rows('driver_confirmations');
    expect(prompts.find(p => p.id === id(30))).toMatchObject({ action: 'released', responded_at: expect.any(String) });
    expect(prompts.find(p => p.id === id(31))!.action).toBe('confirmed'); // already answered: untouched
    expect(prompts.find(p => p.id === id(32))!.action).toBeNull(); // another vehicle: untouched
    const notes = supabaseMock.rows('notifications').filter(n => n.title === 'Stop prompts released');
    expect(notes.map(n => n.user_id).sort()).toEqual([...STAFF].sort());
    expect(notes[0].body).toContain(why);
    expect(notes[0].data.prompts).toEqual([expect.objectContaining({ id: id(30), route_stop_id: id(40) })]);
  });

  it('releases them on leave, but keeps the vehicle', async () => {
    withPrompts();
    const res = await post(admin, DRV, { status: 'on_leave', leave_until: inDays(3) });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('driver_confirmations').find(p => p.id === id(30))!.action).toBe('released');
    expect(supabaseMock.rows('vehicles')[0].driver_id).toBe(DRV);
  });

  it('still refuses on an active route and leaves prompts alone', async () => {
    withPrompts();
    supabaseMock.rows('routes').push({ id: id(20), vehicle_id: VEH, status: 'active' });
    const res = await post(admin, DRV, { status: 'suspended', reason: 'Licence dispute', confirm_release: true });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('driver_confirmations').find(p => p.id === id(30))!.action).toBeNull();
  });
});

describe('payout account and effective_from', () => {
  const bank = (extra: Record<string, any>) => ({
    user_id: DRV, account_holder: 'Ravi Kumar', account_number: '123456789012', ifsc: 'HDFC0001234', bank_name: 'HDFC',
    is_primary: true, is_verified: true, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', ...extra,
  });

  it('uses the primary account once effective_from has passed', async () => {
    supabaseMock.reset(fixtures({ user_bank_accounts: [bank({ id: id(50), effective_from: hoursFromNow(-1) })] }));
    const account = await getPayoutAccount(DRV);
    expect(account).toMatchObject({ id: id(50), account_number: 'XXXXXXXX9012', account_last4: '9012', note: null });
    expect(JSON.stringify(account)).not.toContain('123456789012');
  });

  it('keeps paying the previous account during the cooldown, with a note', async () => {
    const from = hoursFromNow(20);
    supabaseMock.reset(fixtures({
      user_bank_accounts: [
        bank({ id: id(50), is_primary: false, effective_from: '2026-08-01T00:00:00Z', account_number: '999988887777' }),
        bank({ id: id(51), is_primary: true, effective_from: from, account_number: '111122223333' }),
      ],
    }));
    const during = await getPayoutAccount(DRV);
    expect(during).toMatchObject({ id: id(50), account_last4: '7777', pending_from: from });
    expect(during!.note).toMatch(/^New details active from /);
    expect((await getPayoutAccount(DRV, new Date(Date.parse(from) + 1000)))).toMatchObject({ id: id(51), note: null });
  });

  it('has none for a brand-new account still cooling, or for a partner driver', async () => {
    supabaseMock.reset(fixtures({ user_bank_accounts: [bank({ id: id(50), effective_from: hoursFromNow(5) })] }));
    expect(await getPayoutAccount(DRV)).toBeNull();
    supabaseMock.reset(fixtures({
      user_bank_accounts: [bank({ id: id(50), effective_from: hoursFromNow(-5) })],
      user_profiles: [{ user_id: DRV, employer_type: 'partner', updated_at: '2026-09-01T00:00:00Z' }],
    }));
    expect(await getPayoutAccount(DRV)).toBeNull();
  });

  it('shows on the person detail and on the driver earnings API, masked', async () => {
    supabaseMock.reset(fixtures({ user_bank_accounts: [bank({ id: id(50), effective_from: hoursFromNow(-1) })] }));
    const detail = await request(app).get(`/api/v1/people/${DRV}`).set(admin);
    expect(detail.body.payout_account).toMatchObject({ account_number: 'XXXXXXXX9012' });
    expect((await request(app).get(`/api/v1/people/${DRV}`).set(manager)).body.payout_account).toBeNull();

    const earnings = await request(app).get('/api/v1/auth/driver/earnings').set(driver);
    expect(earnings.status).toBe(200);
    expect(earnings.body.payout_account).toMatchObject({ account_number: 'XXXXXXXX9012', ifsc: 'HDFC0001234' });
    expect(JSON.stringify(earnings.body)).not.toContain('123456789012');
    const history = await request(app).get('/api/v1/auth/driver/earnings/history').set(driver);
    expect(history.body.payout_account).toMatchObject({ account_last4: '9012' });
  });
});

describe('licence number warning', () => {
  it('saves an odd licence number and returns the warning text', async () => {
    const res = await request(app).post(`/api/v1/people/${DRV}/documents`).set(admin)
      .send({ doc_type: 'driving_licence', doc_number: 'ABCDE12345', file_path: `people/${DRV}/driving_licence/l.pdf`, expires_on: inDays(400), metadata: { licence_classes: ['LMV'] } });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toContain('licence_number_format');
    expect(res.body.warning_messages.join(' ')).toContain('licence number');
    const ok = await request(app).post(`/api/v1/people/${DRV2}/documents`).set(admin)
      .send({ doc_type: 'driving_licence', doc_number: 'KA0120200012345', file_path: `people/${DRV2}/driving_licence/l.pdf`, expires_on: inDays(400), metadata: { licence_classes: ['LMV'] } });
    expect(ok.status).toBe(201);
    expect(ok.body.warnings).toEqual([]);
    expect(ok.body.warning_messages).toEqual([]);
  });
});

describe('CSV import', () => {
  const csv = [
    'name,role,phone,email,employee code,designation,department,joining date',
    'Asha Nair,driver,9876500101,,E-101,Driver,Ops,01/09/2026',
    'Bharat Rao,manager,,bharat@x.in,E-102,Manager,Ops,2026-09-02',
    'Ravi Again,driver,9876500001,,,,,',
    'Bad Role,pilot,9876500103,,,,,',
    'Asha Twin,driver,9876500101,,,,,',
  ].join('\n');
  const send = (commit: boolean, body = csv) => request(app).post(`/api/v1/people/import${commit ? '?commit=true' : ''}`).set(admin).set('Content-Type', 'text/csv').send(body);

  it('reports errors and duplicates on a dry run without creating anyone', async () => {
    const res = await send(false);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dry_run: true, total: 5 });
    const [asha, bharat, dup, bad, twin] = res.body.rows;
    expect(asha).toMatchObject({ row: 2, status: 'ok' });
    expect(bharat.status).toBe('ok');
    expect(dup).toMatchObject({ status: 'duplicate', duplicate_of: { id: DRV, full_name: 'Ravi Kumar' } });
    expect(bad).toMatchObject({ status: 'error' });
    expect(bad.errors[0]).toContain('role must be one of');
    expect(twin.status).toBe('error');
    expect(twin.errors[0]).toContain('row 2');
    expect(supabaseMock.rows('users')).toHaveLength(5);
  });

  it('creates the good rows on commit and is idempotent when run again', async () => {
    const first = await send(true);
    expect(first.body).toMatchObject({ dry_run: false, created: 2 });
    const users = supabaseMock.rows('users');
    expect(users.find(u => u.phone === '+919876500101')).toMatchObject({ full_name: 'Asha Nair', role: 'driver' });
    expect(users.find(u => u.email === 'bharat@x.in')).toMatchObject({ role: 'manager' });
    expect(users).toHaveLength(7);

    const again = await send(true);
    expect(again.body.created).toBe(0);
    expect(again.body.rows.filter((r: any) => r.status === 'duplicate').map((r: any) => r.row)).toEqual([2, 3, 4, 6]);
    expect(supabaseMock.rows('users')).toHaveLength(7);
  });

  it('is for admins, and needs a name and role header', async () => {
    expect((await request(app).post('/api/v1/people/import').set(manager).set('Content-Type', 'text/csv').send(csv)).status).toBe(403);
    expect((await send(false, 'phone\n9876500101')).status).toBe(400);
  });
});

describe('CSV exports', () => {
  it('exports people with headers, no identity or bank numbers, and IST sign-in times', async () => {
    supabaseMock.rows('user_bank_accounts').push({ id: id(50), user_id: DRV, account_number: '123456789012', account_holder: 'Ravi Kumar', ifsc: 'HDFC0001234', is_primary: true });
    supabaseMock.rows('user_documents').push({
      id: 'd1', user_id: DRV, doc_type: 'pan', status: 'verified', doc_number: 'ABCDE1234F', number_last4: '234F', expires_on: null, archived_at: null, metadata: {},
    });
    const res = await request(app).get('/api/v1/people/export.csv').set(admin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('Name,Role,Status,Phone,Email,Employee code,Designation,Department,Date of joining,Vehicle,Documents required,Verified,Pending,Expiring,Expired,Missing,Last sign-in');
    const ravi = lines.find(l => l.startsWith('Ravi Kumar'))!;
    expect(ravi).toContain('2026-09-29 02:00 IST'); // 20:30 UTC is 02:00 the next day in India
    expect(res.text).not.toContain('123456789012');
    expect(res.text).not.toContain('ABCDE1234F');
    expect((await request(app).get('/api/v1/people/export.csv').set(driver)).status).toBe(403);
  });

  it('exports expiring documents, soonest first, with only the last digits', async () => {
    supabaseMock.rows('user_documents').push(
      { id: 'd1', user_id: DRV, doc_type: 'driving_licence', status: 'verified', number_last4: '2345', expires_on: inDays(20), archived_at: null, metadata: {} },
      { id: 'd2', user_id: DRV2, doc_type: 'driving_licence', status: 'verified', number_last4: '6789', expires_on: inDays(5), archived_at: null, metadata: {} },
      { id: 'd3', user_id: DRV, doc_type: 'pan', status: 'verified', number_last4: '111F', expires_on: inDays(200), archived_at: null, metadata: {} },
    );
    const res = await request(app).get('/api/v1/people/documents/expiring.csv?days=30').set(admin);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('Name,Role,Phone,Document,Number,Expires on,Days left,Status');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Sunil Rao');
    expect(lines[1]).toContain(`ending 6789,${inDays(5)},5`);
    expect(lines[2]).toContain(`ending 2345,${inDays(20)},20`);
    expect((await request(app).get('/api/v1/people/documents/expiring.csv?days=0').set(admin)).status).toBe(400);
  });
});

describe('leave and suspension auto-return', () => {
  it('returns people whose leave or suspension has ended, once, and tells staff', async () => {
    supabaseMock.reset(fixtures({
      users: [
        ...fixtures().users.filter(u => ![DRV, DRV2].includes(u.id)),
        { id: DRV, role: 'driver', is_active: true, status: 'on_leave', full_name: 'Ravi Kumar', phone: '+919876500001' },
        { id: DRV2, role: 'driver', is_active: false, status: 'suspended', full_name: 'Sunil Rao', phone: '+919876500002' },
        { id: id(7), role: 'driver', is_active: true, status: 'on_leave', full_name: 'Still Away', phone: '+919876500007' },
      ],
      user_profiles: [
        { user_id: DRV, leave_from: inDays(-5), leave_until: inDays(-1), updated_at: '2026-09-01T00:00:00Z' },
        { user_id: DRV2, suspended_until: inDays(-1), updated_at: '2026-09-01T00:00:00Z' },
        { user_id: id(7), leave_from: inDays(-1), leave_until: inDays(4), updated_at: '2026-09-01T00:00:00Z' },
      ],
    }));
    expect(await returnFromLeaveAndSuspension()).toBe(2);
    const users = supabaseMock.rows('users');
    expect(users.find(u => u.id === DRV)).toMatchObject({ status: 'active', is_active: true });
    expect(users.find(u => u.id === DRV2)).toMatchObject({ status: 'active', is_active: true });
    expect(users.find(u => u.id === id(7))!.status).toBe('on_leave');
    expect(supabaseMock.rows('user_profiles').find(p => p.user_id === DRV)).toMatchObject({ leave_until: null, leave_from: null });
    expect(supabaseMock.rows('user_status_history').map(h => h.reason).sort()).toEqual(['Leave ended', 'Suspension ended']);
    expect(supabaseMock.rows('user_activity').filter(a => a.action === 'status_changed')).toHaveLength(2);
    const notes = supabaseMock.rows('notifications').filter(n => n.type === 'people_status');
    expect(notes.map(n => n.user_id).sort()).toEqual([SUPER, ADMIN].sort()); // admin-only type

    expect(await returnFromLeaveAndSuspension()).toBe(0);
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'people_status')).toHaveLength(2);
  });
});

describe('document retention', () => {
  const left = (daysAgo: number) => ({ user_id: DRV, from_status: 'active', to_status: 'inactive', reason: 'Left', created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString() });
  const docs = () => [
    { id: 'd1', user_id: DRV, doc_type: 'driving_licence', status: 'verified', file_path: `people/${DRV}/a.pdf`, extra_file_paths: [`people/${DRV}/b.pdf`], expires_on: inDays(300), archived_at: null, metadata: {} },
    { id: 'd2', user_id: DRV, doc_type: 'pan', status: 'verified', file_path: `people/${DRV}/pan.pdf`, extra_file_paths: null, expires_on: null, archived_at: null, metadata: {} },
  ];
  const inactive = () => fixtures().users.map(u => (u.id === DRV ? { ...u, status: 'inactive', is_active: false } : u));

  it('archives files of people who left longer ago than the retention setting, and keeps the records', async () => {
    supabaseMock.reset(fixtures({
      users: inactive(), user_status_history: [left(400)], user_documents: docs(),
      user_profiles: [{ user_id: DRV, photo_path: `people/${DRV}/photo.jpg`, consent_at: '2026-01-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }],
    }));
    expect(await purgeDocumentsAfterRetention()).toBe(2);
    const rows = supabaseMock.rows('user_documents');
    expect(rows).toHaveLength(2);
    for (const d of rows) {
      expect(d).toMatchObject({ file_path: null, extra_file_paths: null, archived_at: expect.any(String) });
      expect(d.metadata.retention_purged_at).toEqual(expect.any(String));
    }
    expect(rows.find(d => d.id === 'd1')).toMatchObject({ status: 'verified', doc_type: 'driving_licence', expires_on: inDays(300) });
    expect(supabaseMock.rows('user_profiles')[0].photo_path).toBeNull();
    expect(supabaseMock.rows('user_activity').some(a => a.action === 'documents_purged' && a.user_id === DRV)).toBe(true);
    expect(supabaseMock.rows('user_status_history')).toHaveLength(1);
    expect(await purgeDocumentsAfterRetention()).toBe(0); // nothing left to purge
  });

  it('keeps files inside the retention window, for active people, and honours a longer setting', async () => {
    supabaseMock.reset(fixtures({ users: inactive(), user_status_history: [left(100)], user_documents: docs() }));
    expect(await purgeDocumentsAfterRetention()).toBe(0);
    supabaseMock.reset(fixtures({ user_documents: docs() })); // still active
    expect(await purgeDocumentsAfterRetention()).toBe(0);
    supabaseMock.reset(fixtures({
      users: inactive(), user_status_history: [left(400)], user_documents: docs(),
      system_settings: [{ key: 'document_retention_days', value: { value: 730 } }],
    }));
    expect(await purgeDocumentsAfterRetention()).toBe(0);
    expect(supabaseMock.rows('user_documents').every(d => d.file_path)).toBe(true);
  });
});

describe('staff digest', () => {
  it('sends each staff member one digest a day however many documents fire', async () => {
    supabaseMock.reset(fixtures({
      user_documents: [
        { id: 'd1', user_id: DRV, doc_type: 'driving_licence', status: 'verified', expires_on: inDays(6), archived_at: null, metadata: {} },
        { id: 'd2', user_id: DRV2, doc_type: 'driving_licence', status: 'verified', expires_on: inDays(-2), archived_at: null, metadata: {} },
        { id: 'd3', user_id: DRV2, doc_type: 'pan', status: 'verified', expires_on: inDays(25), archived_at: null, metadata: {} },
      ],
    }));
    const first = await runPeopleDailyJob();
    expect(first.failed).toEqual([]);
    expect(first.expiry).toMatchObject({ reminders: 3, digest_sent: true });
    const digests = () => supabaseMock.rows('notifications').filter(n => n.type === 'document_expiring' && STAFF.includes(n.user_id));
    expect(digests().map(n => n.user_id).sort()).toEqual([...STAFF].sort());
    expect(digests()[0].data.items).toHaveLength(3);

    const second = await runPeopleDailyJob();
    expect(second.expiry).toMatchObject({ reminders: 0, digest_sent: false });
    expect(digests()).toHaveLength(3);
  });
});
