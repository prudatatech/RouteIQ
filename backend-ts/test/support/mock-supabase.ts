/**
 * In-process stand-in for the Supabase HTTP APIs that supabase-js calls.
 *
 * - GET /auth/v1/.well-known/jwks.json serves a test ES256 public key;
 *   signUserToken() mints Supabase-style user tokens with the private key.
 * - /rest/v1/<table> answers PostgREST requests from in-memory fixtures and
 *   records every write so tests can assert on them.
 * - POST /storage/v1/object/upload/sign/<bucket>/<path> issues a signed upload
 *   URL and records the path; POST /storage/v1/object/sign/<bucket>/<path> does
 *   the same for a signed download URL.
 *
 * - /auth/v1/admin/users (create, list, get, update, delete) and /auth/v1/invite
 *   keep users in memory (`authUsers`) and record each call in `authCalls`, so
 *   tests can create people through Supabase Auth without a real project.
 *
 * Upserts match an existing row on the `on_conflict` columns (default `id`).
 *
 * Filters: `eq.`, `neq.`, `is.` and `in.(...)` on query params. `select`,
 * `order`, `limit` and other operators are ignored, so fixture rows are
 * returned as written (including any embedded relations they carry).
 *
 * Schema validation: every request's `select` (including embedded relations),
 * write body (insert/update/upsert) and column filters (`eq`, `order`, ...)
 * are checked against `db-schema.json` (table -> column list, snapshotted
 * from the live database by `backend-ts/scripts/dump-schema.sql`). An unknown
 * table or column gets a PostgREST-shaped 400 (code 42703), the same as the
 * real API would return, so a query that names a column the database doesn't
 * have fails a test instead of quietly succeeding. See `validateRequest`.
 */
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';

type Schema = Record<string, string[]>;

const schema: Schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'db-schema.json'), 'utf8'));

/** Allowed values of enum columns ("table.column" -> labels), as in the live database. */
const enums: Record<string, string[]> = JSON.parse(fs.readFileSync(path.join(__dirname, 'db-enums.json'), 'utf8'));

/**
 * Postgres rejects a value an enum doesn't have (22P02), in filters and in
 * written rows alike. Returns the message, or null when every value is valid.
 */
function validateEnumValues(table: string, params: URLSearchParams, body: unknown): string | null {
  const bad = (column: string, value: unknown) => {
    const allowed = enums[`${table}.${column}`];
    return allowed && typeof value === 'string' && !allowed.includes(value)
      ? `invalid input value for enum ${table}_${column}: "${value}"`
      : null;
  };
  for (const [key, raw] of params) {
    if (!enums[`${table}.${key}`]) continue;
    const m = /^(?:not\.)?(eq|neq|in)\.(.*)$/.exec(raw);
    if (!m) continue;
    const values = m[1] === 'in' ? m[2].replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')) : [m[2]];
    for (const v of values) {
      const err = bad(key, v);
      if (err) return err;
    }
  }
  for (const row of Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []) {
    for (const [column, value] of Object.entries(row as Record<string, unknown>)) {
      const err = bad(column, value);
      if (err) return err;
    }
  }
  return null;
}

interface ColumnError {
  message: string;
}

/** Split a select-list string at top-level commas (respecting nested parens). */
function splitTopLevel(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of str) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const EMBED_RE = /^(?:(\w+):)?(\w+)(?:!(\w+))?\(([\s\S]*)\)$/;
const COLUMN_RE = /^(?:(\w+):)?(\w+)(?:::\w+)?$/;

/** Validates a PostgREST `select=` value (with possible embedded relations) against `schema`. */
function validateSelect(selectStr: string, table: string): ColumnError | null {
  for (const rawPart of splitTopLevel(selectStr)) {
    const part = rawPart.trim();
    if (!part || part === '*') continue;

    const embed = EMBED_RE.exec(part);
    if (embed) {
      const [, , embedTable, , inner] = embed;
      if (!(embedTable in schema)) {
        return { message: `Could not find a relationship between '${table}' and '${embedTable}' in the schema cache` };
      }
      const nested = validateSelect(inner, embedTable);
      if (nested) return nested;
      continue;
    }

    const col = COLUMN_RE.exec(part);
    if (!col) continue; // aggregate/expression syntax this mock doesn't need to understand
    const column = col[2];
    const columns = schema[table];
    if (columns && column && !columns.includes(column)) {
      return { message: `column ${table}.${column} does not exist` };
    }
  }
  return null;
}

const NON_COLUMN_PARAMS = new Set(['select', 'limit', 'offset', 'on_conflict', 'columns', 'or', 'and']);

/** Validates the filter/order query params of a request against `schema`. */
function validateFilters(table: string, params: URLSearchParams): ColumnError | null {
  const columns = schema[table];
  if (!columns) return null;
  for (const [key] of params) {
    if (NON_COLUMN_PARAMS.has(key) || key.includes('.')) continue; // cross-table filters aren't checked
    if (key === 'order') {
      const value = params.get('order') ?? '';
      for (const part of value.split(',')) {
        const column = part.split('.')[0].trim();
        if (column && !columns.includes(column)) {
          return { message: `column ${table}.${column} does not exist` };
        }
      }
      continue;
    }
    if (!columns.includes(key)) {
      return { message: `column ${table}.${key} does not exist` };
    }
  }
  return null;
}

/** Validates the literal keys of an insert/update/upsert body against `schema`. */
function validateBody(table: string, body: any): ColumnError | null {
  const columns = schema[table];
  if (!columns) return null;
  const rows = Array.isArray(body) ? body : [body];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) {
        return { message: `column ${table}.${key} does not exist` };
      }
    }
  }
  return null;
}

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
      case 'gte':
      case 'gt':
      case 'lte':
      case 'lt': {
        if (actual == null) return false;
        const actualComparable = actual instanceof Date ? actual.getTime() : (Number.isNaN(Number(actual)) ? actual : Number(actual));
        const valueComparable = Number.isNaN(Number(value)) ? value : Number(value);
        if (op === 'gte' && !(actualComparable >= valueComparable)) return false;
        if (op === 'gt' && !(actualComparable > valueComparable)) return false;
        if (op === 'lte' && !(actualComparable <= valueComparable)) return false;
        if (op === 'lt' && !(actualComparable < valueComparable)) return false;
        break;
      }
      default:
        // Operators the app does not rely on in tests (ilike, ...) do not filter
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
  /** `<bucket>/<path>` of every signed download URL issued. */
  signedReads: string[] = [];
  /**
   * Whether the Auth admin API answers. Off by default (calls get a 404, as before it was
   * mocked, which some tests rely on); a test that creates people turns it on.
   */
  authAdmin = false;
  /** Supabase Auth users (id, email, app_metadata, user_metadata). */
  authUsers: Row[] = [];
  /** Every Supabase Auth admin call: `{ op, body }`. */
  authCalls: Array<{ op: 'create' | 'invite' | 'update' | 'delete'; id?: string; body: any }> = [];

  private server: http.Server | null = null;
  private tables = new Map<string, Row[]>();
  private failures = new Map<string, string>();
  private readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

  async start(): Promise<string> {
    // Plain HTTP/1.1 keep-alive. An earlier attempt at "one connection per
    // request" (res.shouldKeepAlive = false here, keepAlive: false on
    // http.globalAgent) destroyed the socket the instant each response
    // finished. That raced with the app's *actual* HTTP client — supabase-js
    // calls fetch(), i.e. undici, which has its own connection pool entirely
    // separate from http.globalAgent — so undici would sometimes dispatch
    // the next request onto a socket this server had just torn down,
    // producing "socket hang up" / ECONNRESET / an HTTP parse error at
    // random. The real fix is on the client: see setGlobalDispatcher in
    // test/support/setup.ts, which disables undici's connection reuse so it
    // never has a pooled socket to race against.
    this.server = http.createServer((req, res) => this.handle(req, res));
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
    this.signedReads = [];
    this.authUsers = [];
    this.authCalls = [];
    this.authAdmin = false;
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

  private handleAuthAdmin(method: string, url: URL, raw: string, send: (status: number, body?: unknown) => void): void {
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    const id = url.pathname.startsWith('/auth/v1/admin/users/') ? decodeURIComponent(url.pathname.split('/').pop() ?? '') : undefined;
    const exists = (email?: string) => !!email && this.authUsers.some(u => u.email === email);
    const taken = () => send(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
    const now = new Date().toISOString();

    if (url.pathname === '/auth/v1/invite' && method === 'POST') {
      this.authCalls.push({ op: 'invite', body });
      // Inviting someone who has not accepted yet sends the invitation again
      const pending = this.authUsers.find(u => u.email === body.email && !u.confirmed);
      if (pending) return send(200, pending);
      if (exists(body.email)) return taken();
      const user = { id: crypto.randomUUID(), aud: 'authenticated', email: body.email, app_metadata: {}, user_metadata: body.data ?? {}, created_at: now };
      this.authUsers.push(user);
      return send(200, user);
    }
    if (!id && method === 'POST') {
      this.authCalls.push({ op: 'create', body });
      if (exists(body.email)) return taken();
      const user = { id: body.id ?? crypto.randomUUID(), aud: 'authenticated', email: body.email, app_metadata: body.app_metadata ?? {}, user_metadata: body.user_metadata ?? {}, created_at: now, confirmed: !!body.email_confirm };
      this.authUsers.push(user);
      return send(200, user);
    }
    if (!id && method === 'GET') return send(200, { users: this.authUsers, aud: 'authenticated' });
    const user = this.authUsers.find(u => u.id === id);
    if (!user) return send(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
    if (method === 'GET') return send(200, user);
    if (method === 'PUT') {
      this.authCalls.push({ op: 'update', id, body });
      if (body.email && body.email !== user.email && exists(body.email)) return taken();
      Object.assign(user, { ...body, app_metadata: { ...user.app_metadata, ...(body.app_metadata ?? {}) } });
      return send(200, user);
    }
    if (method === 'DELETE') {
      this.authCalls.push({ op: 'delete', id, body });
      this.authUsers.splice(this.authUsers.indexOf(user), 1);
      return send(200, {});
    }
    return send(405, { message: `Unsupported method ${method}` });
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
      if (this.authAdmin && (url.pathname.startsWith('/auth/v1/admin/users') || url.pathname === '/auth/v1/invite')) {
        return this.handleAuthAdmin(req.method ?? 'GET', url, raw, send);
      }
      // Storage: signed upload URLs (records the requested object path)
      const signPrefix = '/storage/v1/object/upload/sign/';
      if (req.method === 'POST' && url.pathname.startsWith(signPrefix)) {
        const objectPath = decodeURIComponent(url.pathname.slice(signPrefix.length));
        this.signedUploads.push(objectPath);
        return send(200, { url: `/object/upload/sign/${objectPath}?token=test-upload-token` });
      }
      // Storage: signed download URLs (records the requested object path)
      const readPrefix = '/storage/v1/object/sign/';
      if (req.method === 'POST' && url.pathname.startsWith(readPrefix)) {
        const objectPath = decodeURIComponent(url.pathname.slice(readPrefix.length));
        this.signedReads.push(objectPath);
        return send(200, { signedURL: `/object/sign/${objectPath}?token=test-read-token` });
      }
      if (!url.pathname.startsWith('/rest/v1/')) return send(404, { code: 404, error_code: 'not_found', msg: 'Not found' });

      const table = url.pathname.slice('/rest/v1/'.length);
      const failure = this.failures.get(table);
      if (failure) return send(400, { code: 'XX000', message: failure, details: null, hint: null });

      const sendColumnError = (err: ColumnError) => send(400, { code: '42703', details: null, hint: null, message: err.message });

      const selectParam = url.searchParams.get('select');
      if (selectParam) {
        const err = validateSelect(selectParam, table);
        if (err) return sendColumnError(err);
      }
      const filterErr = validateFilters(table, url.searchParams);
      if (filterErr) return sendColumnError(filterErr);
      if ((req.method === 'POST' || req.method === 'PATCH') && raw) {
        let parsedBody: any;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          parsedBody = undefined;
        }
        if (parsedBody !== undefined) {
          const bodyErr = validateBody(table, parsedBody);
          if (bodyErr) return sendColumnError(bodyErr);
        }
      }
      let written: unknown;
      try {
        written = (req.method === 'POST' || req.method === 'PATCH') && raw ? JSON.parse(raw) : undefined;
      } catch {
        written = undefined;
      }
      const enumErr = validateEnumValues(table, url.searchParams, written);
      if (enumErr) return send(400, { code: '22P02', details: null, hint: null, message: enumErr });

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
            const conflictColumns = (url.searchParams.get('on_conflict') ?? '').split(',').filter(Boolean);
            const existing = !upsert ? undefined
              : conflictColumns.length > 0 ? rows.find(r => conflictColumns.every(c => r[c] === input[c]))
              : input.id != null ? rows.find(r => r.id === input.id) : undefined;
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
