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
import { clearAllMemos } from '../../src/core/memo';
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
    const base = key.split('->')[0]; // a JSON path (input_data->>vendor_id) is checked by its column
    if (!columns.includes(base)) {
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

/** One PostgREST operator applied to a value: `eq`, `in`, `lt`, `is`, and `not.<op>`. */
function opHolds(actual: unknown, op: string, value: string): boolean {
  switch (op) {
    case 'eq':
      return actual != null && String(actual) === value;
    case 'neq':
      return !(actual != null && String(actual) === value);
    case 'is':
      return value === 'null' ? actual == null : String(actual) === value;
    case 'in': {
      const list = value.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, ''));
      return actual != null && list.includes(String(actual));
    }
    case 'gte':
    case 'gt':
    case 'lte':
    case 'lt': {
      if (actual == null) return false;
      const isStamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v);
      const actualComparable = actual instanceof Date ? actual.getTime() : isStamp(actual) && isStamp(value) ? Date.parse(String(actual)) : (Number.isNaN(Number(actual)) ? actual : Number(actual));
      const valueComparable = isStamp(actual) && isStamp(value) ? Date.parse(value) : Number.isNaN(Number(value)) ? value : Number(value);
      if (op === 'gte') return actualComparable >= valueComparable;
      if (op === 'gt') return actualComparable > valueComparable;
      if (op === 'lte') return actualComparable <= valueComparable;
      return actualComparable < valueComparable;
    }
    default:
      // Operators the app does not rely on in tests (ilike, ...) do not filter
      return true;
  }
}

function filterHolds(actual: unknown, filter: string): boolean {
  if (filter.startsWith('not.')) {
    const rest = filter.slice(4);
    const dot = rest.indexOf('.');
    return !opHolds(actual, rest.slice(0, dot), rest.slice(dot + 1));
  }
  const dot = filter.indexOf('.');
  return opHolds(actual, filter.slice(0, dot), filter.slice(dot + 1));
}

/** Splits `a,b(c,d),e` at the commas outside parentheses and quotes. */
function splitOr(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    if (!quoted && c === '(') depth++;
    if (!quoted && c === ')') depth--;
    if (!quoted && depth === 0 && c === ',') {
      parts.push(current);
      current = '';
    } else current += c;
  }
  if (current) parts.push(current);
  return parts;
}

/** A PostgREST logic tree: `or=(a.eq.1,and(b.lt.2,c.gt.3))`. */
function treeHolds(row: Row, text: string, mode: 'or' | 'and'): boolean {
  const results = splitOr(text).map(part => {
    const nested = /^(or|and)\(([\s\S]*)\)$/.exec(part);
    if (nested) return treeHolds(row, nested[2], nested[1] as 'or' | 'and');
    const first = part.indexOf('.');
    const column = part.slice(0, first);
    return filterHolds(row[column], part.slice(first + 1).replace(/^(\w+\.)"(.*)"$/, '$1$2'));
  });
  return mode === 'or' ? results.some(Boolean) : results.every(Boolean);
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, filter] of params) {
    if (column === 'or' || column === 'and') {
      if (!treeHolds(row, filter.replace(/^\(|\)$/g, ''), column)) return false;
      continue;
    }
    if (IGNORED_PARAMS.has(column) || column.includes('.')) continue;
    const path = /^([a-z_]+)->>?([a-z_]+)$/i.exec(column); // JSON path: input_data->>vendor_id
    if (!filterHolds(path ? row[path[1]]?.[path[2]] : row[column], filter)) return false;
  }
  return true;
}

/** `order=created_at.desc,id.desc`, `limit` and `offset` applied to the matching rows of a read. */
function shape(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map(part => {
      const [column, dir] = part.split('.');
      return { column, sign: dir === 'desc' ? -1 : 1 };
    });
    const cmp = (a: unknown, b: unknown) => {
      if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
      const stamps = typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}T/.test(b);
      const x: any = stamps ? Date.parse(a as string) : a;
      const y: any = stamps ? Date.parse(b as string) : b;
      return x < y ? -1 : x > y ? 1 : 0;
    };
    out = [...out].sort((r1, r2) => {
      for (const k of keys) {
        const c = cmp(r1[k.column], r2[k.column]);
        if (c !== 0) return c * k.sign;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') ?? 0);
  const limit = params.get('limit');
  if (offset > 0) out = out.slice(offset);
  if (limit != null && Number.isFinite(Number(limit))) out = out.slice(0, Number(limit));
  return out;
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
  /** Every RPC the app called (`/rest/v1/rpc/<name>`), with its JSON arguments. */
  rpcCalls: Array<{ name: string; fn: string; args: any }> = [];
  /** What an RPC answers (default: null). Cleared by reset(). */
  rpcHandlers = new Map<string, (args: any) => unknown>();
  /** Answer the magic-link calls behind createSupabaseSession with a fixed test session. Cleared by reset(). */
  sessions = false;
  authUsers: Row[] = [];
  /** Every Supabase Auth admin call: `{ op, body }`. */
  authCalls: Array<{ op: 'create' | 'invite' | 'update' | 'delete'; id?: string; body: any }> = [];

  private server: http.Server | null = null;
  private tables = new Map<string, Row[]>();
  private failures = new Map<string, string>();
  private readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

  async start(): Promise<string> {
    // Plain HTTP/1.1 keep-alive. An earlier attempt at "one connection per
    // request" (res.shouldKeepAlive = false here) destroyed the socket the
    // instant each response finished. That raced with the app's *actual*
    // HTTP client — supabase-js calls fetch(), i.e. undici, which has its
    // own connection pool — so undici would sometimes dispatch the next
    // request onto a socket this server had just torn down, producing
    // "socket hang up" / ECONNRESET / an HTTP parse error at random. Idle
    // sockets are left to the default 5s `keepAliveTimeout`, which is longer
    // than undici's 4s (see setGlobalDispatcher in test/support/setup.ts),
    // so the client always gives up a socket before this server closes it.
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
    this.rpcCalls = [];
    this.rpcHandlers.clear();
    this.sessions = false;
    this.authCalls = [];
    this.authAdmin = false;
    this.failures.clear();
    clearAllMemos();
  }

  /** Answer rpc calls to `fn` with `handler(args)`. */
  onRpc(fn: string, handler: (args: any) => unknown): void {
    this.rpcHandlers.set(fn, handler);
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
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
        let args: unknown = null;
        try { args = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
        this.rpcCalls.push({ name, fn: name, args });
        const handler = this.rpcHandlers.get(name);
        let out = handler ? handler(args) : null;
        if (!handler && name === 'dashboard_shipment_counts') {
          const org = (args as { p_carrier_org_id?: string | null })?.p_carrier_org_id;
          out = ['shipments', 'cargo_manifest'].flatMap(table => {
            const counts = new Map<string, number>();
            for (const row of this.rows(table)) {
              if (row.is_master === true || (org && row.carrier_org_id !== org)) continue;
              counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
            }
            return [...counts].map(([status, total]) => ({ source: table === 'shipments' ? 'shipment' : 'manifest', status, total }));
          });
        }
        // A handler raises a database error the way plpgsql RAISE EXCEPTION does: { __rpcError: 'message' }
        if (out && typeof out === 'object' && '__rpcError' in (out as object)) {
          return send(400, { code: 'P0001', message: (out as { __rpcError: string }).__rpcError, details: null, hint: null });
        }
        return send(200, out);
      }
      // Magic-link sessions (createSupabaseSession): off unless a test turns `sessions` on
      if (this.sessions && url.pathname === '/auth/v1/admin/generate_link') {
        return send(200, { action_link: 'http://localhost/verify', email_otp: '123456', hashed_token: 'test-hashed-token', verification_type: 'magiclink', properties: { hashed_token: 'test-hashed-token' } });
      }
      if (this.sessions && url.pathname === '/auth/v1/verify') {
        return send(200, { access_token: 'sb-access-token', refresh_token: 'sb-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: 2_000_000_000, user: { id: 'sb-user', aud: 'authenticated' } });
      }
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
      // Storage: listing a folder (the files that were signed for upload under it, matched by `search`)
      const listPrefix = '/storage/v1/object/list/';
      if (req.method === 'POST' && url.pathname.startsWith(listPrefix)) {
        let body: { prefix?: string; search?: string } = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
        const bucket = decodeURIComponent(url.pathname.slice(listPrefix.length));
        const folder = `${bucket}/${(body.prefix ?? '').replace(/\/$/, '')}/`;
        const names = this.signedUploads.filter(p => p.startsWith(folder)).map(p => p.slice(folder.length)).filter(n => !n.includes('/') && (!body.search || n.includes(body.search)));
        return send(200, names.map(name => ({ name, id: name })));
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
          result = shape(matching, url.searchParams);
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
            // The database stamps a notification's time itself (created_at default now())
            const row = { id: crypto.randomUUID(), ...(table === 'notifications' ? { created_at: new Date().toISOString() } : {}), ...input };
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
