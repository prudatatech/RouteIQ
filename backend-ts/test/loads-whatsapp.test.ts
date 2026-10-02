/**
 * The WhatsApp Cloud API adapter and what posting a load sends: a no-op plus a log when not configured, the PRD 10.3
 * template payload when configured, an email fallback, and never a failure for the person posting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { draft } from './support/load-draft';
import { goodsTables } from './support/goods-world';
import { settings } from '../src/core/config';
import { emailService } from '../src/services/email.service';
import { loadPostedParams, sendLoadPosted, templatePayload, whatsappConfigured } from '../src/services/whatsapp.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const realFetch = globalThis.fetch;

const MESSAGE = { loadNumber: 'MRX-2026-00142', route: 'Mumbai → Delhi', pickupDate: '5 Oct 2026', vehicle: '32 ft SXL Container', totalWeightKg: 20900 };

function configure(on: boolean) {
  Object.assign(settings, on
    ? { WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_ID: '1234567890', WHATSAPP_TEMPLATE_LOAD_POSTED: 'load_posted' }
    : { WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', WHATSAPP_TEMPLATE_LOAD_POSTED: '' });
}

/** Captures calls to the Meta API and lets every other request (the mock database) through. */
function stubMeta(reply: () => Response | Promise<Response> = () => new Response('{}', { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', (url: any, init: any) => {
    if (String(url).includes('graph.facebook.com')) { calls.push({ url: String(url), init }); return Promise.resolve(reply()); }
    return realFetch(url, init);
  });
  return calls;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  configure(false);
});
afterEach(() => { configure(false); vi.unstubAllGlobals(); });

describe('when WhatsApp is not configured', () => {
  it('sends nothing, logs, and never throws', async () => {
    const calls = stubMeta();
    expect(whatsappConfigured()).toBe(false);
    await expect(sendLoadPosted('+919800000000', MESSAGE)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    expect(warn.mock.calls.some(c => String(c[0]).includes('[whatsapp] Not configured'))).toBe(true);
  });

  it('is a no-op when only some of the settings are set', async () => {
    const calls = stubMeta();
    Object.assign(settings, { WHATSAPP_TOKEN: 'wa-token' });
    expect(whatsappConfigured()).toBe(false);
    await expect(sendLoadPosted('+919800000000', MESSAGE)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('when WhatsApp is configured', () => {
  beforeEach(() => configure(true));

  it('posts the load_posted template with the PRD 10.3 parameters to the Cloud API', async () => {
    const calls = stubMeta();
    await expect(sendLoadPosted('+91 98000 00000', MESSAGE)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://graph.facebook.com/v20.0/1234567890/messages');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer wa-token');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '919800000000',
      type: 'template',
      template: {
        name: 'load_posted',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: ['MRX-2026-00142', 'Mumbai → Delhi', '5 Oct 2026', '32 ft SXL Container', '20,900 kg'].map(text => ({ type: 'text', text })) }],
      },
    });
  });

  it('builds its payload and parameters as pure functions', () => {
    expect(loadPostedParams(MESSAGE)).toEqual(['MRX-2026-00142', 'Mumbai → Delhi', '5 Oct 2026', '32 ft SXL Container', '20,900 kg']);
    expect(templatePayload('+919800000000', { name: 't', language: 'en', params: ['a'] }).to).toBe('919800000000');
  });

  it('returns false instead of throwing when the API refuses or the network fails', async () => {
    stubMeta(() => new Response(JSON.stringify({ error: { message: 'Template not approved' } }), { status: 400 }));
    await expect(sendLoadPosted('+919800000000', MESSAGE)).resolves.toBe(false);
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));
    await expect(sendLoadPosted('+919800000000', MESSAGE)).resolves.toBe(false);
  });

  it('sends nothing when the person has no phone', async () => {
    const calls = stubMeta();
    await expect(sendLoadPosted(null, MESSAGE)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('posting a load', () => {
  function world(user: Record<string, unknown>, orgStatus = 'active', tables: Record<string, any[]> = {}) {
    const fixtures = orgWorld({ vendor_profiles: [{ id: uid('vendor-1'), kyc_status: 'approved' }], vendor_shipment_requests: [], load_items: [], ...tables });
    Object.assign(fixtures.users.find(u => u.id === uid('vendor-1'))!, user);
    fixtures.organizations.find(o => o.id === ORG.vendorV)!.status = orgStatus;
    for (const m of fixtures.org_members) if (m.org_id === ORG.vendorV) m.organizations = { ...m.organizations, status: orgStatus };
    supabaseMock.reset(fixtures);
    supabaseMock.rpcHandlers.set('create_vendor_load', ({ p }: any) => ({ id: randomUUID(), status: 'pending', created_at: new Date().toISOString(), ...p.load, load_number: 'MRX-2026-00142', duplicate: false }));
  }
  const post = () => request(app).post(api('/vendor/loads')).set(as('vendor-1')).send(draft());

  it('sends the WhatsApp confirmation with the load details, and no email when it went out', async () => {
    configure(true);
    world({ phone: '+919800000000' });
    const calls = stubMeta();
    const email = vi.spyOn(emailService, 'send').mockResolvedValue(true);
    const res = await post();
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.to).toBe('919800000000');
    const params = body.template.components[0].parameters.map((p: any) => p.text);
    expect(params[0]).toBe('MRX-2026-00142');
    expect(params[1]).toBe('Mumbai → Delhi');
    expect(params[3]).toBe('sxl_32');
    expect(params[4]).toBe('20,900 kg');
    expect(email).not.toHaveBeenCalled();
  });

  it('shows the vehicle by its name, not its key', async () => {
    configure(true);
    world({ phone: '+919800000000' }, 'active', goodsTables());
    const calls = stubMeta();
    const res = await request(app).post(api('/vendor/loads')).set(as('vendor-1')).send(draft({ vehicle_class: 'container_32ft_sxl' }));
    expect(res.status).toBe(201);
    const params = JSON.parse(calls[0].init.body as string).template.components[0].parameters.map((p: any) => p.text);
    expect(params[3]).toBe('Container (32 ft / SXL)');
  });

  it('a held load (business not verified) gets the pending-verification template, not "matching a carrier"', async () => {
    configure(true);
    Object.assign(settings, { WHATSAPP_TEMPLATE_LOAD_HELD: 'load_held' });
    world({ phone: '+919800000000' }, 'pending');
    const calls = stubMeta();
    const res = await post();
    expect(res.status).toBe(201);
    expect(JSON.parse(calls[0].init.body as string).template.name).toBe('load_held');
    Object.assign(settings, { WHATSAPP_TEMPLATE_LOAD_HELD: '' });
  });

  it('a held load with no held template sends no WhatsApp, and the email says verification is pending', async () => {
    configure(true);
    world({ phone: '+919800000000', email: 'vik@example.test' }, 'pending');
    const calls = stubMeta();
    const email = vi.spyOn(emailService, 'send').mockResolvedValue(true);
    const res = await post();
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(0);
    expect(email.mock.calls[0][2]).toMatch(/Business verification pending/);
    expect(email.mock.calls[0][2]).not.toMatch(/matching a verified carrier/);
  });

  it('falls back to email when WhatsApp is not configured and the profile has an email', async () => {
    world({ phone: '+919800000000', email: 'vik@example.test' });
    const calls = stubMeta();
    const email = vi.spyOn(emailService, 'send').mockResolvedValue(true);
    const res = await post();
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(0);
    expect(email).toHaveBeenCalledTimes(1);
    expect(email.mock.calls[0][0]).toBe('vik@example.test');
    expect(email.mock.calls[0][1]).toContain('MRX-2026-00142');
  });

  it('does not email a placeholder login address, and still posts the load with an in-app notification', async () => {
    world({ phone: '+919800000000', email: 'vendor_919800000000@vendor.margixindia.local' });
    const email = vi.spyOn(emailService, 'send').mockResolvedValue(true);
    const res = await post();
    expect(res.status).toBe(201);
    expect(email).not.toHaveBeenCalled();
    expect(supabaseMock.rows('notifications').some(n => n.type === 'load_posted' && n.user_id === uid('vendor-1'))).toBe(true);
  });

  it('never fails the post when WhatsApp or email throws', async () => {
    configure(true);
    world({ phone: '+919800000000', email: 'vik@example.test' });
    stubMeta(() => { throw new Error('boom'); });
    vi.spyOn(emailService, 'send').mockRejectedValue(new Error('smtp down'));
    expect((await post()).status).toBe(201);
  });
});
