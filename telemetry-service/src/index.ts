import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import crypto, { randomUUID } from 'crypto';
import { pool } from './db.js';
import { redis } from './redis.js';

const PORT = process.env.PORT || 8002;
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Store active connections
const activeConnections = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  activeConnections.add(ws);
  console.log(`Client connected. Total clients: ${activeConnections.size}`);

  ws.on('close', () => {
    activeConnections.delete(ws);
    console.log(`Client disconnected. Total clients: ${activeConnections.size}`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket client error:', err);
    activeConnections.delete(ws);
  });
});

// Broadcast helper
function broadcast(message: object) {
  const payload = JSON.stringify(message);
  for (const ws of activeConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error('Failed to send WS message:', err);
      }
    }
  }
}

// Helper to generate internal admin JWT
function generateSystemToken(): string {
  const secret = process.env.SECRET_KEY || 'temporary_secret_key_for_setup';
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: 'system',
    role: 'admin',
    user_id: 'system',
    exp: Math.floor(Date.now() / 1000) + 300
  };
  
  const base64Url = (obj: any) => 
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
      
  const tokenParts = `${base64Url(header)}.${base64Url(payload)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(tokenParts)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
    
  return `${tokenParts}.${signature}`;
}

// Background task trigger for rerouting
async function triggerRerouteCheck(vehicleId: string) {
  try {
    const token = generateSystemToken();
    const backendUrl = process.env.BACKEND_API_URL || 'http://backend:8000';
    const resp = await fetch(`${backendUrl}/api/v1/optimization/incubate/${vehicleId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!resp.ok) {
      console.error(`Failed to trigger reroute check for ${vehicleId}: ${resp.statusText}`);
    } else {
      console.log(`Successfully triggered reroute check for ${vehicleId}`);
    }
  } catch (err) {
    console.error(`Error triggering reroute check for ${vehicleId}:`, err);
  }
}

// Ingestion endpoint
app.post('/api/v1/telemetry', async (req, res) => {
  const client = await pool.connect();
  try {
    const { vehicle_id, latitude, longitude, speed_kmph, heading, fuel_level_pct, timestamp } = req.body;
    
    if (!vehicle_id || latitude === undefined || longitude === undefined) {
      res.status(400).json({ detail: "Missing required fields" });
      return;
    }

    // 1. Fetch vehicle
    const vehicleResult = await client.query(
      'SELECT id, plate_number, status, fuel_capacity_liters FROM vehicles WHERE id = $1',
      [vehicle_id]
    );

    if (vehicleResult.rows.length === 0) {
      res.status(404).json({ detail: `Vehicle ${vehicle_id} not found` });
      return;
    }

    const vehicle = vehicleResult.rows[0];
    const ts = timestamp ? new Date(timestamp) : new Date();

    // Begin transaction
    await client.query('BEGIN');

    // 2. Create Telemetry record
    const telemetryId = randomUUID();
    const telemetryInsert = await client.query(
      `INSERT INTO telemetry (id, vehicle_id, latitude, longitude, speed_kmph, heading, fuel_level_pct, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        telemetryId,
        vehicle_id,
        latitude,
        longitude,
        speed_kmph || 0.0,
        heading || 0.0,
        fuel_level_pct !== undefined ? fuel_level_pct : null,
        ts
      ]
    );

    // 3. Update vehicle position and fuel
    let currentFuel = null;
    if (fuel_level_pct !== undefined && fuel_level_pct !== null) {
      const capacity = vehicle.fuel_capacity_liters || 60.0;
      currentFuel = (fuel_level_pct / 100.0) * capacity;
    }

    if (currentFuel !== null) {
      await client.query(
        `UPDATE vehicles 
         SET latitude = $1, longitude = $2, last_heartbeat = $3, current_fuel_liters = $4
         WHERE id = $5`,
        [latitude, longitude, ts, currentFuel, vehicle_id]
      );
    } else {
      await client.query(
        `UPDATE vehicles 
         SET latitude = $1, longitude = $2, last_heartbeat = $3
         WHERE id = $4`,
        [latitude, longitude, ts, vehicle_id]
      );
    }

    await client.query('COMMIT');

    // 4. Cache latest position in Redis
    const liveData = {
      vehicle_id: String(vehicle_id),
      lat: latitude,
      lng: longitude,
      speed: speed_kmph || 0.0,
      fuel: fuel_level_pct !== undefined ? fuel_level_pct : null,
      timestamp: ts.toISOString()
    };

    await redis.set(`vehicle:live:${vehicle_id}`, JSON.stringify(liveData), 'EX', 120);

    // 5. Broadcast telemetry update
    broadcast({
      type: "TELEMETRY_UPDATE",
      data: liveData
    });

    // 6. High Speed Warning Alert
    const speed = speed_kmph || 0.0;
    if (speed > 85.0) {
      broadcast({
        type: "ALERT_WARNING",
        title: "High Speed Alert",
        message: `Vehicle ${vehicle.plate_number} exceeding safety limit: ${speed.toFixed(1)} km/h`,
        payload: { vehicle_id: String(vehicle_id), plate_number: vehicle.plate_number }
      });
    }

    // 7. AI Incubator rerouting trigger
    if (vehicle.status === 'on_route') {
      const lockKey = `reroute_check_lock:${vehicle_id}`;
      const locked = await redis.get(lockKey);
      if (!locked) {
        await redis.set(lockKey, 'locked', 'EX', 120);
        // Trigger background task (does not block HTTP response)
        triggerRerouteCheck(String(vehicle_id));
      }
    }

    res.status(201).json(telemetryInsert.rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Ingestion failed:', err);
    res.status(500).json({ detail: `Telemetry Ingestion Failed: ${err.message}` });
  } finally {
    client.release();
  }
});

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', app: 'RouteIQ Telemetry Service Node.js' });
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
  if (pathname === '/api/v1/telemetry/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Node.js Telemetry Service running on port ${PORT}`);
});
