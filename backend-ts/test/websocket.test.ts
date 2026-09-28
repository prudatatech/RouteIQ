import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { supabaseMock } from './support/mock-supabase';
import { createHttpServer } from '../src/app';
import { createAccessToken } from '../src/core/auth';

let server: http.Server;
let wsUrl: string;

beforeAll(async () => {
  server = createHttpServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/telemetry/ws`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

beforeEach(() => {
  supabaseMock.reset({ users: [{ id: 'admin-1', role: 'admin', is_active: true }] });
});

/** HTTP status of the upgrade response: 101 when the socket opened. */
function connect(token?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(token ? `${wsUrl}?token=${token}` : wsUrl);
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode!));
    ws.on('error', reject);
  });
}

describe('live fleet WebSocket', () => {
  it('refuses a connection without a token', async () => {
    expect(await connect()).toBe(401);
  });

  it('refuses a driver', async () => {
    expect(await connect(createAccessToken({ sub: 'driver-1', role: 'driver' }))).toBe(403);
  });

  it('refuses a forged unsigned token', async () => {
    const forged = jwt.sign({ sub: 'x', user_metadata: { role: 'superadmin' } }, null as any, { algorithm: 'none' });
    expect(await connect(forged)).toBe(401);
  });

  it('accepts staff', async () => {
    expect(await connect(supabaseMock.signUserToken('admin-1'))).toBe(101);
  });
});
