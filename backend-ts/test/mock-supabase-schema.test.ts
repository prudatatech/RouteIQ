/**
 * The mock Supabase server validates column names against
 * test/support/db-schema.json, so a query naming a column the real database
 * doesn't have fails here the same way it would fail against Supabase,
 * instead of silently succeeding (see mock-supabase.ts's header comment for
 * why this matters — it's what let the `vehicles.city` bug through before).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { supabaseMock } from './support/mock-supabase';

beforeEach(() => {
  supabaseMock.reset({ vehicles: [{ id: 'v1', plate_number: 'DL01AB1234' }] });
});

describe('mock Supabase schema validation', () => {
  it('rejects a select naming an unknown column', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/vehicles?select=id,city`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('42703');
    expect(body.message).toContain('vehicles.city');
  });

  it('rejects a select naming an unknown embedded relation', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/vehicles?select=id,not_a_table(name)`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('42703');
  });

  it('rejects a filter naming an unknown column', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/vehicles?city=eq.Delhi`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('42703');
    expect(body.message).toContain('vehicles.city');
  });

  it('rejects an insert body naming an unknown column', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plate_number: 'DL01ZZ9999', city: 'Mumbai' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('42703');
    expect(body.message).toContain('vehicles.city');
  });

  it('accepts a select and filter that only use real columns', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/vehicles?select=id,plate_number&plate_number=eq.DL01AB1234`);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
  });
  it('rejects a filter with a value the enum does not have (like the open-loads "pending" 500)', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/shipments?select=id&status=in.(created,pending)`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('22P02');
    expect(body.message).toContain('"pending"');
  });

  it('accepts filters that use real enum values', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/shipments?select=id&status=eq.created`);
    expect(res.status).toBe(200);
  });

  it('rejects writing a value the enum does not have', async () => {
    const res = await fetch(`${supabaseMock.url}/rest/v1/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('22P02');
  });
});
