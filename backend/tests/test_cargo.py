import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from asgi_lifespan import LifespanManager
import random

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app) as manager:
        async with AsyncClient(transport=ASGITransport(app=manager.app), base_url="http://test") as c:
            yield c

@pytest.fixture
async def auth_headers(client):
    # Register a test manager
    email = f"test_cargo_{random.randint(1000, 9999)}@routeiq.io"
    await client.post("/api/v1/auth/register", json={
        "email": email,
        "full_name": "Cargo Manager",
        "password": "SecureCargo123!",
        "role": "manager"
    })
    
    # Login
    r = await client.post("/api/v1/auth/login", json={
        "email": email,
        "password": "SecureCargo123!"
    })
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.mark.anyio
async def test_get_cargo_scenarios(client, auth_headers):
    r = await client.get("/api/v1/cargo/scenarios", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert "backhaul" in data
    assert "pooling" in data
    assert data["backhaul"]["truck"]["plate_number"] == "DL-1GC-4922"

@pytest.mark.anyio
async def test_optimize_pooling(client, auth_headers):
    demands = [
        {"company": "Company A (Aero Parts)", "origin": "Delhi", "destination": "Jaipur", "weight_tons": 3.0, "volume_cbm": 8.5},
        {"company": "Company B (Bazaar Retail)", "origin": "Delhi", "destination": "Ajmer", "weight_tons": 2.0, "volume_cbm": 6.0},
        {"company": "Company C (Craft Exports)", "origin": "Delhi", "destination": "Udaipur", "weight_tons": 5.0, "volume_cbm": 15.0}
    ]
    r = await client.post("/api/v1/cargo/optimize-pooling", json=demands, headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["consolidated_distance_km"] == 670.0
    assert data["savings_pct"] > 0
    assert len(data["stops_sequence"]) == 4

@pytest.mark.anyio
async def test_backhaul_match_accepted(client, auth_headers):
    payload = {
        "opportunity_id": "opp-02",
        "available_capacity_kg": 5000
    }
    r = await client.post("/api/v1/cargo/backhaul-match", json=payload, headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "accepted"
    assert data["net_profit_inr"] > 0
    assert len(data["new_route_waypoints"]) == 4

@pytest.mark.anyio
async def test_backhaul_match_rejected_overload(client, auth_headers):
    payload = {
        "opportunity_id": "opp-03", # Apex Heavy Machinery (8000kg)
        "available_capacity_kg": 5000
    }
    r = await client.post("/api/v1/cargo/backhaul-match", json=payload, headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "rejected"
    assert "exceeds" in data["reason"].lower()

@pytest.mark.anyio
async def test_verify_pod_success(client, auth_headers):
    payload = {
        "tracking_id": "SH-99210",
        "otp": "2026",
        "latitude": 24.5854,
        "longitude": 73.7125,
        "photo_uploaded": True
    }
    r = await client.post("/api/v1/cargo/verify-pod", json=payload, headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "verified"
    assert "blockchain_receipt" in data

@pytest.mark.anyio
async def test_verify_pod_invalid_otp(client, auth_headers):
    payload = {
        "tracking_id": "SH-99210",
        "otp": "9999", # Invalid
        "latitude": 24.5854,
        "longitude": 73.7125,
        "photo_uploaded": True
    }
    r = await client.post("/api/v1/cargo/verify-pod", json=payload, headers=auth_headers)
    assert r.status_code == 400
    assert "invalid otp" in r.json()["detail"].lower()

@pytest.mark.anyio
async def test_pricing_recommendations(client, auth_headers):
    r = await client.get("/api/v1/cargo/pricing-recommendations?distance_km=300&weight_kg=5000&cargo_type=cold_chain", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["recommended_freight_rate_inr"] > 0
    assert data["cargo_type_multiplier"] == 1.35
