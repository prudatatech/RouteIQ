"""Test suite for RouteIQ API."""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from asgi_lifespan import LifespanManager


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"



@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app) as manager:
        async with AsyncClient(transport=ASGITransport(app=manager.app), base_url="http://test") as c:
            yield c



@pytest.mark.anyio
async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


@pytest.mark.anyio
async def test_register_and_login(client):
    # Register
    r = await client.post("/api/v1/auth/register", json={
        "email": "test@routeiq.io",
        "full_name": "Test User",
        "password": "Secure1234!",
        "role": "manager",
    })
    assert r.status_code == 201
    assert r.json()["email"] == "test@routeiq.io"

    # Login
    r = await client.post("/api/v1/auth/login", json={
        "email": "test@routeiq.io",
        "password": "Secure1234!",
    })
    assert r.status_code == 200
    assert "access_token" in r.json()


@pytest.mark.anyio
async def test_vrp_solver():
    from app.ml.vrp_solver import Location, VehicleConfig, solve_vrp_ortools

    depot = Location(id="depot", lat=28.6139, lng=77.2090)
    stops = [
        Location(id=f"stop_{i}", lat=28.6139 + i * 0.01, lng=77.2090 + i * 0.01, demand_kg=50)
        for i in range(1, 6)
    ]
    vehicle = VehicleConfig(id="v1", capacity_kg=300, start_location=depot)

    solution = solve_vrp_ortools([depot] + stops, [vehicle], max_solve_seconds=5)
    assert solution.total_distance_km > 0
    assert len(solution.routes) >= 1


@pytest.mark.anyio
async def test_eta_prediction():
    from app.ml.eta_model import eta_predictor

    result = eta_predictor.predict(
        distance_km=20,
        traffic_density=0.7,
        weather_severity=0.3,
        vehicle_type="truck",
    )
    assert result["estimated_minutes"] > 0
    assert result["confidence_interval_low"] <= result["estimated_minutes"]
    assert result["confidence_interval_high"] >= result["estimated_minutes"]
