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
// connection pool, completely separate from node:http's Agent. Keep-alive
// stays on: a new connection per fetch() leaves every socket in TIME_WAIT
// for 30s on macOS, and the full suite's thousands of mock Supabase calls
// then use up the ephemeral ports (connect EADDRNOTAVAIL).
//
// Reuse is safe because the client always gives up an idle socket before
// the server does. undici drops it after 4s, while the mock server (a plain
// node:http server) keeps it for 5s (`server.keepAliveTimeout`). The server
// never closes a socket that undici might still send a request on. When a
// test file ends, `supabaseMock.stop()` closes the idle sockets too.
setGlobalDispatcher(new Agent({ keepAliveTimeout: 4_000, keepAliveMaxTimeout: 4_000 }));

// supertest's requests to the app reuse their connection through the
// keep-alive agent in test/support/test-app.ts, and the 'ws' package's
// WebSocket handshake opens its own connection. This is set only so that
// nothing in this process falls back to a pooled http.globalAgent
// connection by accident.
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
