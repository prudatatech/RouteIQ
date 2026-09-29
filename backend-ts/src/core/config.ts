/**
 * margixindia — Configuration loader
 * Ports: backend/app/core/config.py
 */
import dotenv from 'dotenv';
dotenv.config();

function env(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseFloat(v) : fallback;
}

function envBool(key: string, fallback: boolean = false): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v.toLowerCase() === 'true';
}

export const settings = {
  // App
  APP_NAME: env('APP_NAME', 'margixindia powered by PRUDATA TECHNOLOGIES'),
  APP_ENV: env('APP_ENV', 'development'),
  DEBUG: envBool('DEBUG', false),
  PORT: envInt('PORT', 8000),
  SECRET_KEY: env('SECRET_KEY'),
  ALGORITHM: env('ALGORITHM', 'HS256'),
  ACCESS_TOKEN_EXPIRE_MINUTES: envInt('ACCESS_TOKEN_EXPIRE_MINUTES', 60),
  REFRESH_TOKEN_EXPIRE_DAYS: envInt('REFRESH_TOKEN_EXPIRE_DAYS', 7),

  // Supabase Auth
  SUPABASE_JWT_SECRET: env('SUPABASE_JWT_SECRET'),


  // Supabase
  SUPABASE_URL: env('SUPABASE_URL'),
  SUPABASE_ANON_KEY: env('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: env('SUPABASE_SERVICE_ROLE_KEY'),

  // Redis
  REDIS_URL: env('REDIS_URL', 'redis://127.0.0.1:6380/0'),
  REDIS_CACHE_TTL: envInt('REDIS_CACHE_TTL', 300),

  // External APIs
  GOOGLE_MAPS_API_KEY: env('GOOGLE_MAPS_API_KEY'),
  OPENWEATHER_API_KEY: env('OPENWEATHER_API_KEY'),
  TOMTOM_API_KEY: env('TOMTOM_API_KEY'),
  MAPBOX_ACCESS_TOKEN: env('MAPBOX_ACCESS_TOKEN'),

  // SparkGPS (Roadcast)
  SPARK_GPS_API_URL: env('SPARK_GPS_API_URL', 'https://api.roadcast.in/v1'),
  SPARK_GPS_API_TOKEN: env('SPARK_GPS_API_TOKEN'),
  SPARK_GPS_USERNAME: env('SPARK_GPS_USERNAME'),
  SPARK_GPS_PASSWORD: env('SPARK_GPS_PASSWORD'),
  // Shared secret the GPS provider sends when pushing positions to POST /spark-gps
  SPARK_GPS_PUSH_SECRET: env('SPARK_GPS_PUSH_SECRET'),

  // AWS
  AWS_REGION: env('AWS_REGION', 'ap-south-1'),
  AWS_S3_BUCKET: env('AWS_S3_BUCKET'),

  // Python ML Service
  ML_SERVICE_URL: env('ML_SERVICE_URL', 'http://127.0.0.1:8001'),

  // Twilio (Driver OTP)
  TWILIO_ACCOUNT_SID: env('TWILIO_ACCOUNT_SID'),
  TWILIO_AUTH_TOKEN: env('TWILIO_AUTH_TOKEN'),
  TWILIO_PHONE_NUMBER: env('TWILIO_PHONE_NUMBER'),
  OTP_EXPIRY_SECONDS: envInt('OTP_EXPIRY_SECONDS', 300), // 5 minutes
  OTP_LENGTH: envInt('OTP_LENGTH', 6),

  // KYC / 3PL document uploads (backend-issued signed upload URLs)
  KYC_DOCUMENTS_BUCKET: env('KYC_DOCUMENTS_BUCKET', 'kyc_documents'),
  TPL_UPLOAD_MAX_BYTES: envInt('TPL_UPLOAD_MAX_BYTES', 2 * 1024 * 1024),
  TPL_UPLOAD_URLS_PER_HOUR: envInt('TPL_UPLOAD_URLS_PER_HOUR', 30),
  // Expense receipts go in the same private bucket under expenses/
  EXPENSE_RECEIPT_MAX_BYTES: envInt('EXPENSE_RECEIPT_MAX_BYTES', 5 * 1024 * 1024),

  // Feature Flags
  ENABLE_MOBILE_GPS: envBool('ENABLE_MOBILE_GPS', false),
  ENABLE_HARDWARE_SYNC: envBool('ENABLE_HARDWARE_SYNC', false),

  // Optimization multipliers
  TRAFFIC_FACTOR_MULTIPLIER: envFloat('TRAFFIC_FACTOR_MULTIPLIER', 0.6),
  WEATHER_FACTOR_MULTIPLIER: envFloat('WEATHER_FACTOR_MULTIPLIER', 0.4),

  // Cargo Network APIs
  MAPPLS_CLIENT_ID: env('MAPPLS_CLIENT_ID'),
  MAPPLS_CLIENT_SECRET: env('MAPPLS_CLIENT_SECRET'),
  ULIP_CLIENT_ID: env('ULIP_CLIENT_ID'),
  ULIP_CLIENT_SECRET: env('ULIP_CLIENT_SECRET'),
  FEATURE_FLAG_ULIP_ENABLED: envBool('FEATURE_FLAG_ULIP_ENABLED', false),
  EWAYBILL_GSP_USERNAME: env('EWAYBILL_GSP_USERNAME'),
  EWAYBILL_GSP_PASSWORD: env('EWAYBILL_GSP_PASSWORD'),
  EWAYBILL_GSP_CLIENT_ID: env('EWAYBILL_GSP_CLIENT_ID'),
  FLEET_TELEMATICS_WEBHOOK_SECRET: env('FLEET_TELEMATICS_WEBHOOK_SECRET', 'test_secret'),

  // CORS: exact origins, comma-separated. '*' is not supported.
  get ALLOWED_ORIGINS(): string[] {
    const origins = env('ALLOWED_ORIGINS');
    if (origins) return origins.split(',').map(o => o.trim()).filter(o => o && o !== '*');
    return [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3005',
      'http://127.0.0.1:3005',
    ];
  },

  // CORS: optional regexes (comma-separated), e.g. ^https://margixindia-[a-z0-9-]+\.vercel\.app$
  get CORS_ORIGIN_PATTERNS(): RegExp[] {
    return env('CORS_ORIGIN_PATTERNS')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => new RegExp(p));
  },

  get isProduction(): boolean {
    return this.APP_ENV === 'production'
      || process.env.NODE_ENV === 'production'
      || process.env.RAILWAY_ENVIRONMENT_NAME === 'production';
  },
};
