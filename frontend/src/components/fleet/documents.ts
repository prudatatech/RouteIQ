import type { Vehicle } from './types'

export interface DocRow {
  key: string
  name: string
  number: string | null
  expiry: string | null
  url: string | null
}

/** The five documents a vehicle carries, from its own record. */
export function vehicleDocuments(v: Vehicle): DocRow[] {
  return [
    { key: 'rc', name: 'Registration certificate (RC)', number: v.rc_number ?? null, expiry: v.rc_expiry ?? null, url: v.rc_document_url ?? null },
    { key: 'insurance', name: 'Insurance', number: v.insurance_number ?? null, expiry: v.insurance_expiry ?? null, url: v.insurance_document_url ?? null },
    { key: 'fitness', name: 'Fitness certificate', number: v.fitness_certificate_number ?? null, expiry: v.fitness_expiry ?? null, url: v.fitness_document_url ?? null },
    { key: 'permit', name: 'Permit', number: v.permit_number ?? null, expiry: v.permit_expiry ?? null, url: v.permit_document_url ?? null },
    { key: 'puc', name: 'Pollution certificate (PUC)', number: v.puc_number ?? null, expiry: v.puc_expiry ?? null, url: v.puc_document_url ?? null },
  ]
}

/** The documents with neither an expiry date nor a file on record: nothing is known about them. */
export function missingDocuments(v: Vehicle): DocRow[] {
  return vehicleDocuments(v).filter(d => !d.expiry && !d.url)
}

/** "5 documents not uploaded" / "1 document not uploaded", or null when every document is on file. */
export function missingDocumentsText(count: number): string | null {
  return count > 0 ? `${count.toLocaleString('en-IN')} ${count === 1 ? 'document' : 'documents'} not uploaded` : null
}
