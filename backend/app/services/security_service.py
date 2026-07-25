import hashlib
import json

class SecurityService:
    @staticmethod
    def generate_hash(data: dict, prev_hash: str) -> str:
        """
        Generates a SHA-256 hash for a shipment log.
        Refined per user verdict: payload = json.dumps(data, sort_keys=True) + prev_hash
        """
        payload = json.dumps(data, sort_keys=True) + prev_hash
        return hashlib.sha256(payload.encode()).hexdigest()

    @staticmethod
    def verify_chain(logs: list) -> bool:
        """
        Verifies the integrity of a hash chain of shipment logs.
        Refactor: Verify every log, starting from the first log linked to a base hash.
        """
        if not logs:
            return True
            
        current_prev_hash = "0" * 64
        for log in logs:
            # Construct data as it was hashed
            data = {
                "shipment_id": str(log.shipment_id),
                "status": log.status,
                "location_lat": log.location_lat,
                "location_lng": log.location_lng,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "index": log.index,
                "metadata": log.metadata_json
            }
            
            expected_hash = SecurityService.generate_hash(data, current_prev_hash)
            if log.log_hash != expected_hash:
                return False
            current_prev_hash = log.log_hash
                
        return True
