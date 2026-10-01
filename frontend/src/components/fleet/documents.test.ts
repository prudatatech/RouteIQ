import { describe, expect, it } from 'vitest'
import { missingDocuments, missingDocumentsText } from './documents'
import type { Vehicle } from './types'

describe('missingDocuments', () => {
  it('counts a document with no expiry and no file as missing', () => {
    const v = { rc_expiry: '2030-01-01', insurance_document_url: 'https://x/y.pdf' } as unknown as Vehicle
    expect(missingDocuments(v).map(d => d.key)).toEqual(['fitness', 'permit', 'puc'])
  })
  it('says it in words', () => {
    expect(missingDocumentsText(5)).toBe('5 documents not uploaded')
    expect(missingDocumentsText(1)).toBe('1 document not uploaded')
    expect(missingDocumentsText(0)).toBeNull()
  })
})
