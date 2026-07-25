from fastapi.testclient import TestClient
from app.main import app
from app.core.security import create_access_token

client = TestClient(app)
token = create_access_token({"sub": "8937484a-103d-4048-a4b4-68848d530702"})
resp = client.get('/api/v1/vehicles/?limit=20', headers={"Authorization": f"Bearer {token}"})
print(resp.status_code)
print(resp.json())
