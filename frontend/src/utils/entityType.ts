/**
 * Business entity type, shared by the three onboarding flows that collect it (vendor KYC, logistic-company
 * registration, 3PL partner applications).
 *
 * Keep in step with backend-ts/src/utils/entity-type.ts (same list, same CIN rule).
 */

export const ENTITY_TYPES = ['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited', 'Other'] as const
export type EntityType = typeof ENTITY_TYPES[number]

export const ENTITY_TYPE_OPTIONS = ENTITY_TYPES.map(value => ({ value, label: value }))

/** A company or an LLP is issued a CIN by the Registrar of Companies; a proprietorship or partnership is not. */
const CIN_ENTITY_TYPES: readonly string[] = ['LLP', 'Private Limited', 'Public Limited']

export function entityTypeRequiresCin(entityType: string | null | undefined): boolean {
  return !!entityType && CIN_ENTITY_TYPES.includes(entityType)
}

/** A light-touch format check: 21 letters and digits, the same house style as the PAN/GSTIN checks. */
const CIN_FORMAT = /^[A-Z0-9]{21}$/

export function isCinFormat(cin: string | null | undefined): boolean {
  return !!cin && CIN_FORMAT.test(cin.trim().toUpperCase())
}
