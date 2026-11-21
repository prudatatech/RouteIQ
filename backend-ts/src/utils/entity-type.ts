/**
 * Business entity type, shared by the three onboarding flows that collect it (vendor KYC, logistic-company
 * registration, 3PL partner applications): schemas/vendor.ts, schemas/org.ts, schemas/tpl.ts.
 *
 * Keep in step with frontend/src/utils/entityType.ts (same list, same CIN rule).
 */

export const ENTITY_TYPES = ['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited', 'Other'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

/** A company or an LLP is issued a CIN by the Registrar of Companies; a proprietorship or partnership is not. */
const CIN_ENTITY_TYPES: readonly EntityType[] = ['LLP', 'Private Limited', 'Public Limited'];

export function entityTypeRequiresCin(entityType: unknown): boolean {
  return CIN_ENTITY_TYPES.includes(entityType as EntityType);
}

/**
 * A CIN is 21 characters, letters and digits (for example U74999DL2019PTC123456). This is a light-touch
 * format check, the same house style as the PAN/GSTIN checks in utils/gstin.ts: it catches an obviously
 * wrong value without trying to decode the CIN's internal structure.
 */
const CIN_FORMAT = /^[A-Z0-9]{21}$/;

export function isCinFormat(cin: unknown): boolean {
  return typeof cin === 'string' && CIN_FORMAT.test(cin.trim().toUpperCase());
}
