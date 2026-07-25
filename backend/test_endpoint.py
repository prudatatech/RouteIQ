import asyncio
import urllib.request
from app.core.security import create_access_token
token = create_access_token({"sub": "8937484a-103d-4048-a4b4-68848d530702"})
req = urllib.request.Request('http://localhost:8000/api/v1/routes/?status=active')
req.add_header('Authorization', f'Bearer {token}')
try:
    resp = urllib.request.urlopen(req)
    print(resp.getcode())
    print(resp.read().decode('utf-8'))
except Exception as e:
    print(e)
