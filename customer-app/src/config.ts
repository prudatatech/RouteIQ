/**
 * Runtime configuration, read from EXPO_PUBLIC_* environment variables.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle at build time, so
 * each variable must be referenced literally (no dynamic `process.env[name]`).
 * Set them in customer-app/.env for local development (see .env.example) and
 * as EAS environment variables for builds and updates. There are deliberately
 * no fallbacks: a build without configuration fails at startup instead of
 * silently talking to the wrong backend.
 */

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `[config] Missing required environment variable ${name}. ` +
        'Set it in customer-app/.env (see .env.example) or in the EAS environment for this build.'
    );
  }
  return trimmed;
}

export const API_BASE_URL = required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL).replace(/\/+$/, '');

export const API_V1 = `${API_BASE_URL}/api/v1`;

// The Google Maps key is consumed natively (see app.config.ts), not at runtime.
