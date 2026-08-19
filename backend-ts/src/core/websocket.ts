/**
 * margixindia — WebSocket Connection Manager
 * Ports: backend/app/core/websocket.py
 */
import WebSocket from 'ws';

class ConnectionManager {
  private connections: Set<WebSocket> = new Set();

  connect(ws: WebSocket): void {
    this.connections.add(ws);
  }

  disconnect(ws: WebSocket): void {
    this.connections.delete(ws);
  }

  async sendPersonalMessage(message: string, ws: WebSocket): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }

  async broadcast(message: object | string): Promise<void> {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const failed: WebSocket[] = [];

    for (const ws of this.connections) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        } else {
          failed.push(ws);
        }
      } catch {
        failed.push(ws);
      }
    }

    // Cleanup disconnected clients
    for (const ws of failed) {
      this.connections.delete(ws);
    }
  }

  get connectionCount(): number {
    return this.connections.size;
  }
}

export const wsManager = new ConnectionManager();
