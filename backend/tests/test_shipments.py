import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from asgi_lifespan import LifespanManager

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.fixture
async def client():
    async with LifespanManager(app) as manager:
        async with AsyncClient(transport=ASGITransport(app=manager.app), base_url="http://test") as c:
            yield c

@pytest.fixture
async def auth_headers(client):
    # Register test user
    await client.post("/api/v1/auth/register", json={
        "email": "test_shipments@routeiq.io",
        "full_name": "Shipment Test User",
        "password": "Secure1234!",
        "role": "manager",
    })
    
    # Login
    r = await client.post("/api/v1/auth/login", json={
        "email": "test_shipments@routeiq.io",
        "password": "Secure1234!",
    })
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.mark.anyio
async def test_shipment_flow(client, auth_headers):
    # 1. Create a delivery point manually in DB or via an endpoint if it exists
    # Since there's no POST /delivery-points, let's use the DB session directly if we can,
    # or just test the list endpoint which was reported as failing.
    
    # 2. Test Listing (should be empty but 200)
    r = await client.get("/api/v1/shipments/", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    # 3. Test Routes Delivery Points listing
    r = await client.get("/api/v1/routes/delivery-points", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

@pytest.mark.anyio
async def test_create_shipment_validation(client, auth_headers):
    # Test with invalid data to ensure it doesn't 500
    payload = {
        "priority": "invalid",
        "parcels": []
    }
    r = await client.post("/api/v1/shipments/", json=payload, headers=auth_headers)
    assert r.status_code == 422 # Validation error, not 500

