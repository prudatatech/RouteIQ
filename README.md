# 🚀 RouteIQ — Fleet Intelligence Platform

> **AI-powered fleet management and route optimization platform built with FastAPI, React, and Google OR-Tools.**

[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docker.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://postgresql.org)

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Getting Started](#getting-started)
6. [Environment Variables](#environment-variables)
7. [API Reference](#api-reference)
8. [Database Models](#database-models)
9. [ML & Optimization Engine](#ml--optimization-engine)
10. [Frontend Pages & Roles](#frontend-pages--roles)
11. [User Roles & Credentials](#user-roles--credentials)
12. [Monitoring & Observability](#monitoring--observability)
13. [Running Tests](#running-tests)
14. [Deployment](#deployment)

---

## Overview

RouteIQ is a full-stack fleet intelligence platform that combines:

- **AI-driven VRP (Vehicle Routing Problem) solver** using [Google OR-Tools](https://developers.google.com/optimization) with a nearest-neighbor greedy fallback
- **ETA prediction** via an XGBoost/LightGBM ML model with traffic and weather factors
- **Dynamic rerouting engine** for real-time adjustments
- **Live telemetry** for GPS tracking of vehicles on a map
- **Role-based access control** across four user tiers: `superadmin`, `admin`, `manager`, `driver`
- **Real-time monitoring** with Prometheus + Grafana dashboards
- **Async background tasks** with Celery + Redis

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Browser                                 │
│              React 18 + TypeScript + MapLibre GL                 │
│                  Served via Nginx (port 3005)                    │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP / REST
┌────────────────────────▼─────────────────────────────────────────┐
│                    FastAPI Backend (port 8001)                   │
│  • JWT Auth  • REST API v1  • Prometheus Metrics  • GZip         │
│  • ML: VRP Solver (OR-Tools) + ETA Model + Reroute Engine        │
└───────┬──────────────────────┬───────────────────────────────────┘
        │                      │
┌───────▼──────┐    ┌──────────▼─────────┐
│  PostgreSQL  │    │       Redis         │
│  (port 5433) │    │  Cache + Broker     │
│  16-alpine   │    │  (port 6380)        │
└──────────────┘    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Celery Workers    │
                    │  (4 concurrency)    │
                    │  + Celery Beat      │
                    └─────────────────────┘

┌──────────────────┐    ┌──────────────────┐
│   Prometheus     │    │     Grafana       │
│  (port 9091)     │───▶│  (port 3002)      │
└──────────────────┘    └──────────────────┘
```

---

## Tech Stack

### Backend
| Component      | Technology                                      |
|---------------|------------------------------------------------|
| Framework      | FastAPI 0.111 + Uvicorn (async)                |
| Database ORM   | SQLAlchemy 2.0 (async) + Alembic migrations    |
| Database       | PostgreSQL 16                                  |
| Cache/Broker   | Redis 7 (via aioredis)                         |
| Task Queue     | Celery 5.4 + Kombu                             |
| Auth           | JWT (python-jose) + bcrypt (passlib)           |
| ML             | OR-Tools 9.10, XGBoost, LightGBM, scikit-learn |
| HTTP Client    | httpx + aiohttp                                |
| Monitoring     | prometheus-client                              |
| Testing        | pytest + pytest-asyncio + factory-boy          |

### Frontend
| Component      | Technology                             |
|---------------|----------------------------------------|
| Framework      | React 18 + TypeScript 5               |
| Routing        | React Router v6                        |
| State          | Zustand (authStore)                    |
| Map            | MapLibre GL                            |
| HTTP Client    | Axios (services/api.ts)                |
| Styling        | Tailwind CSS + custom CSS              |
| Build Tool     | Vite                                   |
| Web Server     | Nginx (production)                     |

### Infrastructure
| Service        | Port  | Purpose                        |
|---------------|-------|--------------------------------|
| Frontend       | 3005  | React app via Nginx            |
| Backend API    | 8001  | FastAPI REST API               |
| PostgreSQL     | 5433  | Primary database               |
| Redis          | 6380  | Cache + Celery broker          |
| Prometheus     | 9091  | Metrics collection             |
| Grafana        | 3002  | Metrics visualization          |

---

## Project Structure

```
routeiq/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── endpoints/
│   │   │       │   ├── auth.py          # Login, register, refresh, logout
│   │   │       │   ├── users.py         # User CRUD
│   │   │       │   ├── vehicles.py      # Vehicle management
│   │   │       │   ├── routes.py        # Route listing and tracking
│   │   │       │   ├── optimization.py  # VRP solve + ETA prediction
│   │   │       │   ├── telemetry.py     # GPS data ingestion
│   │   │       │   └── dashboard.py     # KPI aggregations
│   │   │       └── router.py            # API route aggregator
│   │   ├── core/
│   │   │   ├── config.py               # Pydantic settings
│   │   │   ├── database.py             # Async SQLAlchemy engine
│   │   │   ├── security.py             # JWT + password hashing
│   │   │   ├── redis.py                # Redis client
│   │   │   ├── celery_app.py           # Celery configuration
│   │   │   └── logging.py              # Structured logging
│   │   ├── middleware/
│   │   │   ├── metrics.py              # Prometheus middleware
│   │   │   └── request_id.py           # Request tracing
│   │   ├── ml/
│   │   │   ├── vrp_solver.py           # OR-Tools VRP solver
│   │   │   ├── eta_model.py            # ETA prediction model
│   │   │   └── reroute_engine.py       # Dynamic rerouting
│   │   ├── models/
│   │   │   └── models.py               # SQLAlchemy ORM models
│   │   ├── schemas/
│   │   │   └── schemas.py              # Pydantic request/response schemas
│   │   ├── services/                   # Business logic layer
│   │   ├── utils/                      # Helpers and utilities
│   │   └── main.py                     # FastAPI app entry point
│   ├── alembic/                        # DB migration scripts
│   ├── tests/                          # pytest test suite
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example
│   └── seed_users.py                   # Seed script for demo users
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── FleetPage.tsx
│   │   │   ├── RoutesPage.tsx
│   │   │   ├── OptimizePage.tsx
│   │   │   ├── AnalyticsPage.tsx
│   │   │   ├── AIHubPage.tsx
│   │   │   └── SuperadminPage.tsx
│   │   ├── components/
│   │   │   ├── dashboard/              # KPI cards, alert feed, AI insights
│   │   │   ├── fleet/                  # Vehicle table, add vehicle form
│   │   │   ├── map/                    # LiveMap (MapLibre GL)
│   │   │   └── ui/                     # AppLayout, sidebar, shared UI
│   │   ├── services/
│   │   │   └── api.ts                  # Axios API client
│   │   ├── store/
│   │   │   └── authStore.ts            # Zustand auth state
│   │   ├── hooks/                      # Custom React hooks
│   │   └── utils/                      # Frontend helpers
│   ├── nginx.conf
│   └── Dockerfile
│
├── infra/
│   └── prometheus/
│       ├── prometheus.yml
│       └── grafana_datasource.yml
│
├── scripts/
│   └── init.sql                        # PostgreSQL initialization
│
└── docker-compose.yml
```

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (v25+)
- [Git](https://git-scm.com/)

### 1. Clone the repository

```bash
git clone https://github.com/vishalkumar-swe/RouteIq.git
cd RouteIq
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and fill in your values (see [Environment Variables](#environment-variables)).

### 3. Start all services

```bash
docker compose up -d --build
```

This starts 7 services: `db`, `redis`, `backend`, `celery_worker`, `celery_beat`, `frontend`, `prometheus`, `grafana`.

### 4. Seed demo users

```bash
docker exec -it routeiq_backend python seed_users.py
```

### 5. Open in browser

| Service      | URL                           |
|-------------|-------------------------------|
| Frontend     | http://localhost:3005          |
| API Docs     | http://localhost:8001/docs     |
| ReDoc        | http://localhost:8001/redoc    |
| Grafana      | http://localhost:3002          |
| Prometheus   | http://localhost:9091          |

---

## Environment Variables

Copy `backend/.env.example` → `backend/.env` and fill in the values:

```env
# Application
APP_NAME=RouteIQ
APP_ENV=development
DEBUG=true
SECRET_KEY=<generate with: openssl rand -hex 32>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7

# Database
DATABASE_URL=postgresql+asyncpg://routeiq:routeiq_pass@db:5432/routeiq
DATABASE_POOL_SIZE=20
DATABASE_MAX_OVERFLOW=10

# Redis
REDIS_URL=redis://redis:6379/0
REDIS_CACHE_TTL=300

# Celery
CELERY_BROKER_URL=redis://redis:6379/1
CELERY_RESULT_BACKEND=redis://redis:6379/2

# External APIs (optional)
GOOGLE_MAPS_API_KEY=your-key
OPENWEATHER_API_KEY=your-key
TOMTOM_API_KEY=your-key

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

> ⚠️ **Never commit your `.env` file.** It is already listed in `.gitignore`.

---

## API Reference

All API routes are prefixed with `/api/v1`.

### Authentication — `/api/v1/auth`

| Method | Endpoint    | Description              | Auth Required |
|--------|------------|--------------------------|---------------|
| POST   | `/register` | Register a new user      | No            |
| POST   | `/login`    | Login and get JWT tokens | No            |
| POST   | `/refresh`  | Refresh access token     | No            |
| POST   | `/logout`   | Logout (client-side)     | No            |

**Login Request:**
```json
{
  "email": "admin@routeiq.com",
  "password": "Admin@123"
}
```

**Login Response:**
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "bearer",
  "role": "admin"
}
```

---

### Users — `/api/v1/users`

| Method | Endpoint | Description         | Roles          |
|--------|---------|---------------------|----------------|
| GET    | `/`     | List all users      | superadmin     |
| GET    | `/me`   | Get current user    | All            |
| PATCH  | `/{id}` | Update user         | superadmin     |
| DELETE | `/{id}` | Delete user         | superadmin     |

---

### Vehicles — `/api/v1/vehicles`

| Method | Endpoint | Description             | Roles                      |
|--------|---------|-------------------------|----------------------------|
| GET    | `/`     | List all vehicles       | admin, manager, superadmin |
| POST   | `/`     | Add a vehicle           | admin, superadmin          |
| GET    | `/{id}` | Get vehicle details     | All                        |
| PATCH  | `/{id}` | Update vehicle          | admin, superadmin          |
| DELETE | `/{id}` | Remove vehicle          | superadmin                 |

**Vehicle Types:** `truck`, `van`, `bike`, `car`  
**Vehicle Statuses:** `available`, `on_route`, `idle`, `maintenance`, `offline`

---

### Route Optimization — `/api/v1/optimize`

| Method | Endpoint | Description                        | Roles              |
|--------|---------|------------------------------------|--------------------|
| POST   | `/`     | Solve VRP and create optimized routes | admin, manager  |
| POST   | `/eta`  | Predict ETA for a delivery         | All authenticated  |

**Optimization Request:**
```json
{
  "depot_id": "uuid",
  "vehicle_ids": ["uuid1", "uuid2"],
  "delivery_point_ids": ["uuid3", "uuid4"],
  "max_solve_time_seconds": 30,
  "consider_traffic": true
}
```

**Optimization Response:**
```json
{
  "job_id": "uuid",
  "status": "completed",
  "routes": [...],
  "total_distance_km": 142.5,
  "total_fuel_liters": 18.3,
  "estimated_savings_pct": 23.4,
  "solve_time_seconds": 2.1,
  "message": "Optimized 3 routes in 2.10s"
}
```

**ETA Request:**
```json
{
  "distance_km": 45,
  "traffic_density": 0.7,
  "weather_severity": 0.2,
  "vehicle_type": "truck"
}
```

---

### Routes — `/api/v1/routes`

| Method | Endpoint       | Description           | Roles |
|--------|---------------|-----------------------|-------|
| GET    | `/`           | List all routes       | All   |
| GET    | `/{id}`       | Get route details     | All   |
| PATCH  | `/{id}/status`| Update route status   | All   |

**Route Statuses:** `pending`, `optimizing`, `active`, `completed`, `cancelled`

---

### Telemetry — `/api/v1/telemetry`

| Method | Endpoint     | Description                       | Roles  |
|--------|-------------|-----------------------------------|--------|
| POST   | `/`         | Push GPS data for a vehicle       | driver |
| GET    | `/{vehicle_id}` | Get latest telemetry for vehicle | All  |

---

### Dashboard — `/api/v1/dashboard`

| Method | Endpoint  | Description                        | Roles |
|--------|-----------|------------------------------------|-------|
| GET    | `/`       | Get KPI summary (active vehicles, routes, fuel, etc.) | All |

---

### Health

| Method | Endpoint  | Description                     |
|--------|-----------|---------------------------------|
| GET    | `/health` | Liveness check                  |
| GET    | `/ready`  | Readiness check (Redis + DB OK) |
| GET    | `/metrics`| Prometheus metrics endpoint     |

---

## Database Models

### User
| Column            | Type      | Description                          |
|-------------------|-----------|--------------------------------------|
| `id`              | UUID (PK) | Primary key                          |
| `email`           | String    | Unique email address                 |
| `full_name`       | String    | Display name                         |
| `hashed_password` | String    | bcrypt hashed password               |
| `role`            | Enum      | `superadmin`, `admin`, `manager`, `driver` |
| `is_active`       | Boolean   | Account enabled                      |
| `last_login`      | DateTime  | Last successful login                |

### Vehicle
| Column                  | Type    | Description                    |
|-------------------------|---------|--------------------------------|
| `id`                    | UUID    | Primary key                    |
| `plate_number`          | String  | Unique license plate           |
| `vehicle_type`          | Enum    | `truck`, `van`, `bike`, `car`  |
| `capacity_kg`           | Float   | Max payload capacity           |
| `fuel_type`             | String  | `diesel`, `petrol`, `electric` |
| `fuel_capacity_liters`  | Float   | Tank capacity                  |
| `fuel_efficiency_kmpl`  | Float   | Km per litre                   |
| `status`                | Enum    | `available`, `on_route`, `idle`, `maintenance`, `offline` |
| `driver_id`             | UUID FK | Assigned driver (User)         |

### Route
| Column                  | Type    | Description                    |
|-------------------------|---------|--------------------------------|
| `id`                    | UUID    | Primary key                    |
| `vehicle_id`            | UUID FK | Assigned vehicle               |
| `depot_id`              | UUID FK | Starting depot                 |
| `status`                | Enum    | `pending`, `optimizing`, `active`, `completed`, `cancelled` |
| `total_distance_km`     | Float   | Total planned distance         |
| `total_duration_minutes`| Float   | Estimated duration             |
| `estimated_fuel_liters` | Float   | Estimated fuel usage           |
| `waypoints`             | JSON    | Ordered list of GPS waypoints  |
| `optimization_score`    | Float   | Route efficiency score (0-1)   |

### Other Models
- **`Depot`** — Warehouse/depot location (lat/lng)
- **`DeliveryPoint`** — Customer delivery location with demand and time windows
- **`RouteStop`** — Junction between Route and DeliveryPoint with sequence order
- **`Telemetry`** — Real-time GPS ping from a vehicle

---

## ML & Optimization Engine

### 1. VRP Solver (`app/ml/vrp_solver.py`)

Solves the **Vehicle Routing Problem** — assigns delivery points to vehicles with minimum total distance, respecting vehicle capacity and time windows.

**Algorithm:** Google OR-Tools (Constraint Programming)
- Strategy: `PATH_CHEAPEST_ARC` (greedy seed)
- Metaheuristic: `GUIDED_LOCAL_SEARCH`
- Time limit: configurable (default 30 seconds)
- Distance metric: Haversine (great-circle) with `traffic_factor` multiplier
- **Fallback:** Nearest-Neighbour greedy (when OR-Tools is unavailable)

**Key classes:**

```python
Location(id, lat, lng, demand_kg, time_window_start, time_window_end, service_time)
VehicleConfig(id, capacity_kg, start_location)
VRPSolution(routes, total_distance_km, total_fuel_liters, solve_time_seconds, savings_vs_naive_pct)
```

**Usage:**
```python
from app.ml.vrp_solver import solve_vrp_ortools, Location, VehicleConfig

solution = solve_vrp_ortools(
    locations=[depot_loc, *delivery_locs],
    vehicles=vehicle_configs,
    max_solve_seconds=30,
    traffic_factor=1.3,   # 30% traffic overhead
)
print(f"Saved {solution.savings_vs_naive_pct}% vs unoptimized")
```

---

### 2. ETA Prediction (`app/ml/eta_model.py`)

Predicts estimated arrival time using:
- `distance_km` — delivery distance
- `traffic_density` — 0.0 (free flow) to 1.0 (heavy traffic)
- `weather_severity` — 0.0 (clear) to 1.0 (severe)
- `vehicle_type` — `truck`, `van`, `bike`, `car`

Model trained on historical delivery data using **XGBoost/LightGBM** with feature engineering.

---

### 3. Reroute Engine (`app/ml/reroute_engine.py`)

Dynamically recalculates route segments when:
- A vehicle reports an unexpected stop (breakdown, accident)
- Traffic conditions change significantly
- A delivery is cancelled mid-route

---

## Frontend Pages & Roles

| Page             | Route          | Access Roles                        | Description                                          |
|-----------------|----------------|-------------------------------------|------------------------------------------------------|
| Login            | `/login`       | Public                              | JWT-based login form                                 |
| Dashboard        | `/dashboard`   | All roles                           | KPI cards, live alerts, AI insight cards, live map   |
| Fleet            | `/fleet`       | superadmin, admin, manager          | Vehicle listing, add/edit/delete vehicles            |
| Routes           | `/routes`      | All roles                           | Active and historical route listing                  |
| Optimize         | `/optimize`    | superadmin, admin, manager          | Run VRP optimization, view results                   |
| Analytics        | `/analytics`   | superadmin, admin, manager          | Charts, delivery performance, fuel reports           |
| AI Hub           | `/ai-hub`      | superadmin, admin                   | ETA predictor, rerouting controls, ML model status   |
| Superadmin       | `/superadmin`  | superadmin only                     | User management, system configuration                |

---

## User Roles & Credentials

After running the seed script (`python seed_users.py`), the following demo accounts are available:

| Role        | Email                        | Password   | Access Level                      |
|-------------|------------------------------|------------|-----------------------------------|
| Superadmin  | `superadmin@routeiq.com`     | `Super@123`| Full system access                |
| Admin       | `admin@routeiq.com`          | `Admin@123`| Fleet, routes, optimization, analytics |
| Manager     | `manager@routeiq.com`        | `Manager@123`| Fleet (read), routes, optimize  |
| Driver      | `driver@routeiq.com`         | `Driver@123` | Dashboard, own routes only      |

> 🔒 Change all passwords before deploying to production.

---

## Monitoring & Observability

### Prometheus
Accessible at **http://localhost:9091**

Metrics collected by the `PrometheusMiddleware`:
- `http_requests_total` — request count by method, path, and status
- `http_request_duration_seconds` — request latency histogram
- Standard Python process metrics (CPU, memory, GC)

Configuration: `infra/prometheus/prometheus.yml`

### Grafana
Accessible at **http://localhost:3002**

Default credentials: `admin` / `admin123`

The Prometheus datasource is pre-provisioned via `infra/prometheus/grafana_datasource.yml`.

### Logging
Structured JSON logging is configured in `app/core/logging.py`. Each request is tagged with a unique `X-Request-ID` header (injected by `RequestIDMiddleware`).

---

## Running Tests

```bash
# Run all tests inside the container
docker exec -it routeiq_backend pytest tests/ -v

# Or locally with venv activated
cd backend
pip install -r requirements.txt
pytest tests/ -v --asyncio-mode=auto
```

The test suite uses:
- **pytest-asyncio** for async endpoint testing
- **factory-boy** for test fixture factories
- Separate test database (configure `TEST_DATABASE_URL` if needed)

---

## Deployment

### Production Checklist

- [ ] Set `APP_ENV=production` and `DEBUG=false`
- [ ] Generate a strong `SECRET_KEY`: `openssl rand -hex 32`
- [ ] Use a managed PostgreSQL (e.g., AWS RDS, Supabase, Neon)
- [ ] Use a managed Redis (e.g., AWS ElastiCache, Upstash)
- [ ] Set `ALLOWED_ORIGINS` to your production frontend domain
- [ ] Enable HTTPS via a reverse proxy (Nginx, Caddy, or AWS ALB)
- [ ] Set up Sentry DSN for error tracking (`SENTRY_DSN`)
- [ ] Change Grafana admin password

### Docker Production Build

```bash
# Build production images
docker compose -f docker-compose.yml build

# Start in production mode
docker compose up -d

# Run database migrations
docker exec routeiq_backend alembic upgrade head
```

### Scaling Celery Workers

```bash
# Scale to 3 worker replicas
docker compose up -d --scale celery_worker=3
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to your branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## License

This project is proprietary. All rights reserved © 2026 RouteIQ.

---

*Built with ❤️ using FastAPI, React, Google OR-Tools, and Docker.*
#   R o u t e I Q  
 