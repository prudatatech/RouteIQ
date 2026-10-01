import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { testApp } from './support/test-app';

const app = testApp();
const preflight = (origin: string) =>
  request(app).options('/api/v1/dashboard/kpis').set('Origin', origin).set('Access-Control-Request-Method', 'GET');

describe('CORS', () => {
  it('allows the web app on its own domains', async () => {
    for (const origin of ['https://margixindia.com', 'https://portal.margixindia.com', 'https://staging.margixindia.com']) {
      expect((await preflight(origin)).headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('refuses look-alike and plain-http origins', async () => {
    for (const origin of ['https://margixindia.vercel.app', 'https://portal.margixindia.com.evil.com', 'http://portal.margixindia.com', 'https://evilmargixindia.com']) {
      expect((await preflight(origin)).headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
