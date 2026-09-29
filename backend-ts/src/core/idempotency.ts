/**
 * margixindia — Idempotency keys
 *
 * A request may carry an `idempotency_key` (body) or an `Idempotency-Key` header.
 * The first successful response is stored under (user, key). A repeat with the
 * same key gets that stored response back and the handler does not run again, so
 * an action the driver app resends after a lost reply is applied once.
 *
 * Failed requests (status 400 and above) are not stored, so they can be retried.
 * Without a key the handler runs as usual.
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { supabase } from './supabase';
import { sendError, HttpError } from './errors';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Prune expired rows on about one write in this many. */
const PRUNE_ONE_IN = 50;

/** Requests being handled right now, so a repeat that arrives mid-flight waits for the first. */
const inFlight = new Map<string, Promise<void>>();

function keyOf(req: Request): string | null {
  const fromBody = typeof req.body?.idempotency_key === 'string' ? req.body.idempotency_key : null;
  const fromHeader = req.header('Idempotency-Key');
  const key = fromBody ?? fromHeader ?? null;
  if (key === null) return null;
  if (!KEY_PATTERN.test(key)) throw new HttpError(400, 'idempotency_key must be 8 to 100 letters, digits, dashes or underscores');
  return key;
}

async function findStored(userId: string, key: string) {
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('action, status_code, response')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`Idempotency lookup failed: ${error.message}`);
  return data as { action: string; status_code: number; response: unknown } | null;
}

async function store(userId: string, key: string, action: string, statusCode: number, response: unknown): Promise<void> {
  const { error } = await supabase.from('idempotency_keys').insert({ user_id: userId, key, action, status_code: statusCode, response });
  // A racing duplicate already stored it; that is fine
  if (error && error.code !== '23505') console.warn('[idempotency] could not store key:', error.message);
  if (Math.floor(Math.random() * PRUNE_ONE_IN) === 0) {
    await supabase.from('idempotency_keys').delete().lt('created_at', new Date(Date.now() - RETENTION_MS).toISOString());
  }
}

/** Route middleware. Put it after requireAuth. `action` names the endpoint, so a key cannot be reused across endpoints. */
export function idempotent(action: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    let key: string | null;
    try {
      key = keyOf(req);
    } catch (e) {
      sendError(req, res, e);
      return;
    }
    if (key === null || !req.user) {
      next();
      return;
    }
    const userId = req.user.user_id;
    const flightKey = `${userId}:${key}`;

    // Wait out an earlier request with the same key, then claim the key before any other await
    let running = inFlight.get(flightKey);
    while (running) {
      await running;
      running = inFlight.get(flightKey);
    }
    let release!: () => void;
    inFlight.set(flightKey, new Promise<void>(resolve => { release = resolve; }));
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      inFlight.delete(flightKey);
      release();
    };

    try {
      const stored = await findStored(userId, key);
      if (stored) {
        if (stored.action !== action) throw new HttpError(409, 'This idempotency_key was used for a different action');
        res.setHeader('Idempotent-Replay', 'true');
        res.status(stored.status_code).json(stored.response ?? {});
        done();
        return;
      }

      const send = res.json.bind(res);
      res.json = ((body?: unknown) => {
        if (res.statusCode < 400) {
          store(userId, key, action, res.statusCode, body)
            .catch(e => console.warn('[idempotency] store failed:', e))
            .finally(() => {
              done();
              send(body);
            });
          return res;
        }
        done();
        return send(body);
      }) as Response['json'];
      res.on('close', done);
      next();
    } catch (e) {
      done();
      sendError(req, res, e);
    }
  };
}
