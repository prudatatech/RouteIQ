from typing import List
from fastapi import WebSocket
import json

class ConnectionManager:
    def __init__(self):
        # Map of client_id -> WebSocket
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: dict):
        # Pre-serialize once to reduce CPU overhead for high-concurrency broadcasts
        payload = json.dumps(message)
        
        # Create a list of failed connections to remove
        failed = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                failed.append(connection)
        
        # Cleanup disconnected clients
        for conn in failed:
            try:
                self.disconnect(conn)
            except ValueError:
                pass

manager = ConnectionManager()
