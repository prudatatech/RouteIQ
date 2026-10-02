/**
 * margixindia — WebSocket Connection Manager
 * Ports: backend/app/core/websocket.py
 */
import WebSocket from 'ws';

class ConnectionManager {
  /** Each connection with the company whose events it receives; null receives every company's (the platform, or no organisations yet). */
  private connections: Map<WebSocket, string | null> = new Map();

  connect(ws: WebSocket, orgId: string | null = null): void {
    this.connections.set(ws, orgId);
  }

  disconnect(ws: WebSocket): void {
    this.connections.delete(ws);
  }

  async sendPersonalMessage(message: string, ws: WebSocket): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }

  /**
   * Send to every connection that may see it: `ownerOrgId` is the company the news is about, and only its
   * connections (and the unscoped ones) receive it. With no owner only the unscoped ones do.
   */
  async broadcast(message: object | string, ownerOrgId?: string | null): Promise<void> {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const failed: WebSocket[] = [];

    for (const [ws, scope] of this.connections) {
      if (scope !== null && scope !== ownerOrgId) continue;
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
