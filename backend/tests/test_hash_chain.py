import uuid
import json
from datetime import datetime
from app.services.security_service import SecurityService

def test_hash_chain_integrity():
    """
    Test that the hash chain is correctly generated and validated.
    """
    # 1. Create a dummy log entry
    fixed_ts = "2024-03-31T12:00:00"
    log1_data = {
        "shipment_id": str(uuid.uuid4()),
        "status": "created",
        "location_lat": 12.9716,
        "location_lng": 77.5946,
        "timestamp": fixed_ts,
        "index": 0,
        "metadata": None
    }
    prev_hash_0 = "0" * 64
    log1_hash = SecurityService.generate_hash(log1_data, prev_hash_0)
    
    # Mock log objects
    class MockLog:
        def __init__(self, data, log_hash, prev_hash):
            self.shipment_id = data["shipment_id"]
            self.status = data["status"]
            self.location_lat = data["location_lat"]
            self.location_lng = data["location_lng"]
            self.timestamp = datetime.fromisoformat(data["timestamp"])
            self.index = data["index"]
            self.log_hash = log_hash
            self.previous_hash = prev_hash
            self.metadata_json = data.get("metadata")

    l1 = MockLog(log1_data, log1_hash, prev_hash_0)
    
    # 2. Create second log entry linked to first
    log2_data = {
        "shipment_id": log1_data["shipment_id"],
        "status": "in_transit",
        "location_lat": 12.9800,
        "location_lng": 77.6000,
        "timestamp": fixed_ts,
        "index": 1,
        "metadata": None
    }
    log2_hash = SecurityService.generate_hash(log2_data, log1_hash)
    l2 = MockLog(log2_data, log2_hash, log1_hash)
    
    # 3. Verify valid chain
    assert SecurityService.verify_chain([l1, l2]) is True
    
    # 4. Tamper with log 1
    l1.status = "tampered"
    assert SecurityService.verify_chain([l1, l2]) is False

def test_empty_chain():
    assert SecurityService.verify_chain([]) is True
