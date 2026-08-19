/**
 * margixindia — Security Service (Hash Chain)
 * Ports: backend/app/services/security_service.py
 */
import crypto from 'crypto';

export class SecurityService {
  /**
   * Generates a SHA-256 hash for a shipment log.
   * payload = JSON.stringify(data, sorted_keys) + prev_hash
   */
  static generateHash(data: Record<string, any>, prevHash: string): string {
    // Sort keys to match Python's json.dumps(data, sort_keys=True)
    const sortedData = Object.keys(data)
      .sort()
      .reduce((acc: Record<string, any>, key) => {
        acc[key] = data[key];
        return acc;
      }, {});

    const payload = JSON.stringify(sortedData) + prevHash;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Verifies the integrity of a hash chain of shipment logs.
   */
  static verifyChain(logs: Array<{
    shipment_id: string;
    status: string;
    location_lat: number | null;
    location_lng: number | null;
    timestamp: string | null;
    index: number;
    metadata_json: Record<string, any>;
    log_hash: string;
  }>): boolean {
    if (!logs || logs.length === 0) return true;

    let currentPrevHash = '0'.repeat(64);

    for (const log of logs) {
      const data: Record<string, any> = {
        shipment_id: log.shipment_id,
        status: log.status,
        location_lat: log.location_lat,
        location_lng: log.location_lng,
        timestamp: log.timestamp,
        index: log.index,
        metadata: log.metadata_json,
      };

      const expectedHash = SecurityService.generateHash(data, currentPrevHash);
      if (log.log_hash !== expectedHash) {
        return false;
      }
      currentPrevHash = log.log_hash;
    }

    return true;
  }
}
