import { describe, expect, it } from 'vitest';
import { SecurityService } from '../src/services/security.service';

describe('shipment log hash chain', () => {
  const base = { shipment_id: 's1', status: 'picked_up', location_lat: null, location_lng: null, timestamp: '2026-10-02T10:00:00.000Z', index: 0 };

  it('does not depend on the order of the metadata keys (jsonb returns its own order)', () => {
    const written = { custody_kind: 'pickup', pieces: 5, actor_id: 'u1', condition: null };
    const hash = SecurityService.generateHash({ ...base, metadata: written }, '0'.repeat(64));
    // jsonb hands keys back by length, then alphabetically
    const read = { pieces: 5, actor_id: 'u1', condition: null, custody_kind: 'pickup' };
    expect(SecurityService.verifyChain([{ ...base, metadata_json: read, log_hash: hash }])).toBe(true);
  });

  it('detects a changed metadata value', () => {
    const hash = SecurityService.generateHash({ ...base, metadata: { pieces: 5 } }, '0'.repeat(64));
    expect(SecurityService.verifyChain([{ ...base, metadata_json: { pieces: 6 }, log_hash: hash }])).toBe(false);
  });
});
