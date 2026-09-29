/**
 * Runs before each test file, ahead of any app module import.
 *
 * Settings are read from the environment when src/core/config.ts loads, so
 * the mock Supabase server is started and every variable the app reads is
 * pinned here. Credentials are set empty on purpose: tests never reach
 * Upstash (the cache falls back to memory), Twilio (OTPs are logged), Resend
 * or a real Supabase project, whatever the developer's shell or .env holds.
 */
import http from 'node:http';
import { Agent, setGlobalDispatcher } from 'undici';
import { afterAll, vi } from 'vitest';
import { supabaseMock } from './mock-supabase';

// supabase-js (PostgREST, GoTrue/JWKS, Storage) all call the global fetch(),
// which Node implements with undici — a client with its own keep-alive
// connection pool, completely separate from node:http's Agent. Each test
// file's mock Supabase server is short-lived (a fresh instance on a fresh
// port per file, per `test/support/mock-supabase.ts`), so a socket undici
// keeps pooled past the moment the server considers a response finished
// (or the file ends and the server closes) is a socket that can be handed
// back out for a later request and get ECONNRESET, "socket hang up", or a
// desynced HTTP parse ("Parse Error: Expected HTTP/...") when reused.
// Disabling pooling means every fetch() opens its own connection, so there
// is never a stale socket to race against.
setGlobalDispatcher(new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1 }));

// supertest's requests to the app (superagent, via node:http with
// `agent: false`) and the 'ws' package's WebSocket handshake already open a
// fresh connection per request/handshake, so this has no effect on pooling
// for them — it's set only so nothing in this process falls back to a
// pooled http.globalAgent connection by accident.
http.globalAgent = new http.Agent({ keepAlive: false });

// Never load a developer's backend-ts/.env into tests
vi.mock('dotenv', () => {
  const config = () => ({ parsed: {} });
  return { default: { config }, config };
});

const TEST_JWT_SECRET = 'test-backend-secret-'.padEnd(48, 'x');

const url = await supabaseMock.start();

Object.assign(process.env, {
  APP_ENV: 'test',
  NODE_ENV: 'test',
  RAILWAY_ENVIRONMENT_NAME: '',
  DEBUG: 'false',
  PORT: '0',

  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  SECRET_KEY: '',
  PEOPLE_HASH_SALT: 'test-people-hash-salt',

  // A test that forgets to mock the IFSC lookup fails fast instead of reaching Razorpay
  IFSC_LOOKUP_BASE_URL: 'http://127.0.0.1:9',

  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
  REDIS_URL: '',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_PHONE_NUMBER: '',
  RESEND_API_KEY: '',
  SPARK_GPS_PUSH_SECRET: '',
  SPARK_GPS_API_TOKEN: '',
  SPARK_GPS_USERNAME: '',
  SPARK_GPS_PASSWORD: '',
  ENABLE_HARDWARE_SYNC: 'false',
  ENABLE_MOBILE_GPS: 'false',
  FEATURE_FLAG_ULIP_ENABLED: 'false',
  GOOGLE_MAPS_API_KEY: '',
  OPENWEATHER_API_KEY: '',
  TOMTOM_API_KEY: '',
  MAPBOX_ACCESS_TOKEN: '',
  MAPPLS_CLIENT_ID: '',
  MAPPLS_CLIENT_SECRET: '',
  ULIP_CLIENT_ID: '',
  ULIP_CLIENT_SECRET: '',
  EWAYBILL_GSP_USERNAME: '',
  EWAYBILL_GSP_PASSWORD: '',
  EWAYBILL_GSP_CLIENT_ID: '',
  EWAYBILL_GSP_BASE_URL: '',
  AWS_S3_BUCKET: '',
});

afterAll(() => supabaseMock.stop());
