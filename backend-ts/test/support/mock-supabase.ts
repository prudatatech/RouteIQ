/**
 * In-process stand-in for the Supabase HTTP APIs that supabase-js calls.
 *
 * - GET /auth/v1/.well-known/jwks.json serves a test ES256 public key;
 *   signUserToken() mints Supabase-style user tokens with the private key.
 * - /rest/v1/<table> answers PostgREST requests from in-memory fixtures and
 *   records every write so tests can assert on them.
 * - POST /storage/v1/object/upload/sign/<bucket>/<path> issues a signed upload
 *   URL and records the path.
 *
 * Filters: `eq.`, `neq.`, `is.` and `in.(...)` on query params. `select`,
 * `order`, `limit` and other operators are ignored, so fixture rows are
 * returned as written (including any embedded relations they carry).
 */
import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';

export type Row = Record<string, any>;

export interface Mutation {
  method: 'POST' | 'PATCH' | 'DELETE';
  table: string;
  body: any;
  query: Record<string, string>;
}

const IGNORED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'or', 'and']);
const SINGLE_OBJECT = 'application/vnd.pgrst.object+json';

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, filter] of params) {
    if (IGNORED_PARAMS.has(column) || column.includes('.')) continue;
    const dot = filter.indexOf('.');
    const op = filter.slice(0, dot);
    const value = filter.slice(dot + 1);
    const actual = row[column];
    switch (op) {
      case 'eq':
        if (actual == null || String(actual) !== value) return false;
        break;
      case 'neq':
        if (actual != null && String(actual) === value) return false;
        break;
      case 'is':
        if (value === 'null' ? actual != null : String(actual) !== value) return false;
        break;
      case 'in': {
        const list = value.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, ''));
        if (actual == null || !list.includes(String(actual))) return false;
        break;
      }
      default:
        // Operators the app does not rely on in tests (gte, ilike, ...) do not filter
        break;
    }
  }
  return true;
}

class MockSupabase {
  url = '';
  readonly kid = 'test-key';
  /** Every insert, update and delete, in order. */
  mutations: Mutation[] = [];
  /** Every request URL (path and query), in order. */
  requests: URL[] = [];
  /** `<bucket>/<path>` of every signed upload URL issued. */
  signedUploads: string[] = [];

  private server: http.Server | null = null;
  private tables = new Map<string, Row[]>();
  private failures = new Map<string, string>();
  private readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

  async start(): Promise<string> {
    // One connection per request: reusing idle keep-alive sockets raced with the server
    // closing them and failed random tests with ECONNRESET.
    this.server = http.createServer((req, res) => {
      res.shouldKeepAlive = false;
      this.handle(req, res);
    });
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  /** Replace all tables with `fixtures` and forget recorded writes and failures. */
  reset(fixtures: Record<string, Row[]> = {}): void {
    this.tables = new Map(Object.entries(fixtures).map(([table, rows]) => [table, rows.map(r => structuredClone(r))]));
    this.mutations = [];
    this.requests = [];
    this.signedUploads = [];
    this.failures.clear();
  }

  /** Live rows of a table (mutable). */
  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  /** Make every request to `table` fail with a database error carrying `message`. */
  fail(table: string, message: string): void {
    this.failures.set(table, message);
  }

  writes(table: string, method?: Mutation['method']): Mutation[] {
    return this.mutations.filter(m => m.table === table && (!method || m.method === method));
  }

  /** A user access token as Supabase Auth issues it (ES256, verified via the JWKS). */
  signUserToken(sub: string, claims: Row = {}, options: { issuer?: string; expiresIn?: number } = {}): string {
    return jwt.sign({ sub, aud: 'authenticated', role: 'authenticated', ...claims }, this.keys.privateKey, {
      algorithm: 'ES256',
      keyid: this.kid,
      issuer: options.issuer ?? `${this.url}/auth/v1`,
      expiresIn: options.expiresIn ?? 600,
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', this.url);
      this.requests.push(url);
      const send = (status: number, body?: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };

      if (url.pathname === '/auth/v1/.well-known/jwks.json') {
        const jwk = { ...this.keys.publicKey.export({ format: 'jwk' }), kid: this.kid, alg: 'ES256', use: 'sig' };
        return send(200, { keys: [jwk] });
      }
      if (url.pathname.startsWith('/rest/v1/rpc/')) return send(200, null);
      // Storage: signed upload URLs (records the requested object path)
      const signPrefix = '/storage/v1/object/upload/sign/';
      if (req.method === 'POST' && url.pathname.startsWith(signPrefix)) {
        const objectPath = decodeURIComponent(url.pathname.slice(signPrefix.length));
        this.signedUploads.push(objectPath);
        return send(200, { url: `/object/upload/sign/${objectPath}?token=test-upload-token` });
      }
      if (!url.pathname.startsWith('/rest/v1/')) return send(404, { code: 404, error_code: 'not_found', msg: 'Not found' });

      const table = url.pathname.slice('/rest/v1/'.length);
      const failure = this.failures.get(table);
      if (failure) return send(400, { code: 'XX000', message: failure, details: null, hint: null });

      const rows = this.rows(table);
      const matching = rows.filter(row => matches(row, url.searchParams));
      let result: Row[];

      switch (req.method) {
        case 'GET':
        case 'HEAD':
          result = matching;
          break;
        case 'POST': {
          const body = raw ? JSON.parse(raw) : {};
          this.mutations.push({ method: 'POST', table, body, query: Object.fromEntries(url.searchParams) });
          const upsert = String(req.headers['prefer'] ?? '').includes('merge-duplicates');
          result = (Array.isArray(body) ? body : [body]).map((input: Row) => {
            const existing = upsert && input.id != null ? rows.find(r => r.id === input.id) : undefined;
            if (existing) return Object.assign(existing, input);
            const row = { id: crypto.randomUUID(), ...input };
            rows.push(row);
            return row;
          });
          break;
        }
        case 'PATCH': {
          const body = raw ? JSON.parse(raw) : {};
          this.mutations.push({ method: 'PATCH', table, body, query: Object.fromEntries(url.searchParams) });
          result = matching.map(row => Object.assign(row, body));
          break;
        }
        case 'DELETE':
          this.mutations.push({ method: 'DELETE', table, body: null, query: Object.fromEntries(url.searchParams) });
          for (const row of matching) rows.splice(rows.indexOf(row), 1);
          result = matching;
          break;
        default:
          return send(405, { message: `Unsupported method ${req.method}` });
      }

      res.setHeader('Content-Range', result.length ? `0-${result.length - 1}/${result.length}` : '*/0');
      if (req.method === 'HEAD') return send(200);

      // .single() asks PostgREST for exactly one row as a bare object
      if (String(req.headers['accept'] ?? '').includes(SINGLE_OBJECT)) {
        if (result.length !== 1) {
          return send(406, {
            code: 'PGRST116',
            details: `The result contains ${result.length} rows`,
            hint: null,
            message: 'JSON object requested, multiple (or no) rows returned',
          });
        }
        return send(req.method === 'POST' ? 201 : 200, result[0]);
      }
      send(req.method === 'POST' ? 201 : 200, result);
    });
  }
}

/** One mock per test file (vitest isolates modules per file). */
export const supabaseMock = new MockSupabase();
