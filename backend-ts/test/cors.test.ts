import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { testApp } from './support/test-app';

const app = testApp();
const preflight = (origin: string) =>
  request(app).options('/api/v1/dashboard/kpis').set('Origin', origin).set('Access-Control-Request-Method', 'GET');

describe('CORS', () => {
  it('allows the web app on its own domains', async () => {
    for (const origin of ['https://margixindia.com', 'https://app.margixindia.com', 'https://margixindia.vercel.app']) {
      expect((await preflight(origin)).headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('refuses look-alike and plain-http origins', async () => {
    for (const origin of ['https://evil-margixindia.vercel.app', 'https://margixindia.vercel.app.evil.com', 'http://margixindia.vercel.app']) {
      expect((await preflight(origin)).headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
