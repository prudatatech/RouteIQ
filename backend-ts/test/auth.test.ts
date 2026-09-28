import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { supabaseMock } from './support/mock-supabase';
import { authenticateToken, createAccessToken, createRefreshToken } from '../src/core/auth';

const SECRET = process.env.SUPABASE_JWT_SECRET!;

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: 'admin-user', role: 'admin', is_active: true },
      { id: 'plain-driver', role: 'driver', is_active: true },
      { id: 'inactive-user', role: 'admin', is_active: false },
    ],
    vendor_profiles: [{ id: 'vendor-user' }],
    tpl_partners: [],
  });
});

describe('backend-issued tokens', () => {
  it('accepts an access token', async () => {
    const user = await authenticateToken(createAccessToken({ sub: 'd1', role: 'driver' }));
    expect(user).toEqual({ user_id: 'd1', role: 'driver', source: 'backend' });
  });

  it('accepts a legacy token without iss that carries a type', async () => {
    const token = jwt.sign({ sub: 'd1', role: 'driver', type: 'access', user_metadata: { role: 'driver' } }, SECRET);
    expect((await authenticateToken(token)).role).toBe('driver');
  });

  it('rejects a refresh token used as an access token', async () => {
    await expect(authenticateToken(createRefreshToken({ sub: 'd1', role: 'driver' }))).rejects.toThrow();
  });

  it('accepts a refresh token only where one is expected', async () => {
    const refresh = createRefreshToken({ sub: 'd1', role: 'driver' });
    expect((await authenticateToken(refresh, 'refresh')).role).toBe('driver');
    await expect(authenticateToken(createAccessToken({ sub: 'd1', role: 'driver' }), 'refresh')).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign(
      { sub: 'd1', role: 'driver', type: 'access', exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET,
      { issuer: 'margix-backend' },
    );
    await expect(authenticateToken(token)).rejects.toThrow();
  });
});

describe('forged tokens', () => {
  it('rejects an unsigned alg=none token', async () => {
    const token = jwt.sign({ sub: 'x', user_metadata: { role: 'superadmin' } }, null as any, { algorithm: 'none' });
    await expect(authenticateToken(token)).rejects.toThrow();
  });

  it('rejects an HS256 token signed with the wrong secret', async () => {
    const token = jwt.sign({ sub: 'x', role: 'superadmin', type: 'access' }, 'wrong-secret');
    await expect(authenticateToken(token)).rejects.toThrow();
  });

  it('rejects an anon/service-role style token without a subject', async () => {
    const token = jwt.sign({ iss: 'supabase', role: 'service_role' }, SECRET);
    await expect(authenticateToken(token)).rejects.toThrow();
  });
});

describe('Supabase (ES256) tokens', () => {
  it('reads the role from public.users', async () => {
    expect(await authenticateToken(supabaseMock.signUserToken('admin-user')))
      .toEqual({ user_id: 'admin-user', role: 'admin', source: 'supabase' });
  });

  it('ignores a role claimed in user_metadata', async () => {
    const token = supabaseMock.signUserToken('plain-driver', { user_metadata: { role: 'superadmin' } });
    expect((await authenticateToken(token)).role).toBe('driver');
  });

  it('resolves a user with a vendor profile to vendor', async () => {
    expect((await authenticateToken(supabaseMock.signUserToken('vendor-user'))).role).toBe('vendor');
  });

  it('rejects a user with no role', async () => {
    await expect(authenticateToken(supabaseMock.signUserToken('nobody'))).rejects.toThrow();
  });

  it('rejects an inactive user', async () => {
    await expect(authenticateToken(supabaseMock.signUserToken('inactive-user'))).rejects.toThrow(/inactive/);
  });

  it('rejects a token from another issuer', async () => {
    const token = supabaseMock.signUserToken('admin-user', {}, { issuer: 'https://evil.example/auth/v1' });
    await expect(authenticateToken(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = supabaseMock.signUserToken('admin-user', {}, { expiresIn: -10 });
    await expect(authenticateToken(token)).rejects.toThrow();
  });

  it('is not accepted on the refresh endpoint', async () => {
    await expect(authenticateToken(supabaseMock.signUserToken('admin-user'), 'refresh')).rejects.toThrow();
  });
});
