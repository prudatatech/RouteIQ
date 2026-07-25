from fastapi.testclient import TestClient
from app.main import app
from app.core.security import get_current_user
from app.schemas.auth import TokenData
import uuid

def mock_get_current_user():
    return TokenData(user_id="8937484a-103d-4048-a4b4-68848d530702", role="admin")

app.dependency_overrides[get_current_user] = mock_get_current_user
client = TestClient(app)

endpoints = [
    '/api/v1/vehicles/',
    '/api/v1/shipments/',
    '/api/v1/dashboard/kpis',
    '/api/v1/cargo/scenarios'
]

for ep in endpoints:
    resp = client.get(ep)
    print(f"{ep}: {resp.status_code}")
    if resp.status_code == 500:
        print(resp.text)
