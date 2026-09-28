/**
 * Runs before each test file, ahead of any app module import.
 *
 * Settings are read from the environment when src/core/config.ts loads, so
 * the mock Supabase server is started and every variable the app reads is
 * pinned here. Credentials are set empty on purpose: tests never reach
 * Upstash (the cache falls back to memory), Twilio (OTPs are logged), Resend
 * or a real Supabase project, whatever the developer's shell or .env holds.
 */
import { afterAll, vi } from 'vitest';
import { supabaseMock } from './mock-supabase';

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
  AWS_S3_BUCKET: '',
});

afterAll(() => supabaseMock.stop());
