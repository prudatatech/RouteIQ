-- ROUTEIQ COMPLETE DATABASE SCHEMA
-- Target: PostgreSQL / Supabase
-- Created: 2026-04-02

BEGIN;

-- 1. ENUM TYPES
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'manager', 'driver');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE vehicle_type AS ENUM ('truck', 'van', 'bike', 'car');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE vehicle_status AS ENUM ('available', 'on_route', 'idle', 'maintenance', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE route_status AS ENUM ('pending', 'optimizing', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE shipment_status AS ENUM ('created', 'picked_up', 'in_transit', 'delivered', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE shipment_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. TABLES

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'driver',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipments (
    id UUID PRIMARY KEY,
    tracking_id VARCHAR(50) UNIQUE NOT NULL,
    status shipment_status DEFAULT 'created',
    priority shipment_priority DEFAULT 'medium',
    origin_name VARCHAR(255),
    origin_address TEXT,
    origin_lat FLOAT,
    origin_lng FLOAT,
    total_items INTEGER DEFAULT 1,
    total_weight_kg FLOAT DEFAULT 0.0,
    received_by VARCHAR(100),
    signature_data TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY,
    plate_number VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type vehicle_type DEFAULT 'truck',
    capacity_kg FLOAT DEFAULT 1000,
    fuel_type VARCHAR(20) DEFAULT 'diesel',
    fuel_capacity_liters FLOAT DEFAULT 60.0,
    fuel_efficiency_kmpl FLOAT DEFAULT 12.0,
    current_fuel_liters FLOAT DEFAULT 60.0,
    status vehicle_status DEFAULT 'available',
    latitude FLOAT,
    longitude FLOAT,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    spark_id VARCHAR(50),
    last_sync TIMESTAMP WITH TIME ZONE,
    driver_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS depots (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0,
    heading FLOAT DEFAULT 0.0,
    fuel_level_pct FLOAT DEFAULT 100.0,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSON DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_points (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0,
    heading FLOAT DEFAULT 0.0,
    fuel_level_pct FLOAT DEFAULT 100.0,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSON DEFAULT '[]',
    demand_kg FLOAT DEFAULT 0.0,
    service_time_minutes INTEGER DEFAULT 10,
    required_cargo_types JSON DEFAULT '[]',
    status VARCHAR(20) DEFAULT 'pending',
    shipment_id UUID REFERENCES shipments(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routes (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    depot_id UUID REFERENCES depots(id),
    status route_status DEFAULT 'pending',
    total_distance_km FLOAT DEFAULT 0.0,
    total_duration_minutes FLOAT DEFAULT 0.0,
    estimated_fuel_liters FLOAT DEFAULT 0.0,
    weather_condition VARCHAR(50) DEFAULT 'clear',
    traffic_delay_minutes INTEGER DEFAULT 0,
    waypoints JSON DEFAULT '[]',
    optimization_score FLOAT DEFAULT 0.0,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_stops (
    id UUID PRIMARY KEY,
    route_id UUID REFERENCES routes(id),
    delivery_point_id UUID REFERENCES delivery_points(id),
    sequence INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemetry (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0,
    heading FLOAT DEFAULT 0.0,
    fuel_level_pct FLOAT DEFAULT 100.0,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSON DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS vehicle_stoppages (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0,
    heading FLOAT DEFAULT 0.0,
    fuel_level_pct FLOAT DEFAULT 100.0,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSON DEFAULT '[]',
    reason VARCHAR(255) DEFAULT 'unknown',
    duration_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maintenance_alerts (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    alert_type VARCHAR(50) NOT NULL,
    severity alert_severity DEFAULT 'medium',
    description TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parcels (
    id UUID PRIMARY KEY,
    shipment_id UUID REFERENCES shipments(id),
    weight_kg FLOAT NOT NULL,
    length_cm FLOAT NOT NULL,
    width_cm FLOAT NOT NULL,
    height_cm FLOAT NOT NULL,
    category VARCHAR(50) NOT NULL,
    is_hazardous BOOLEAN DEFAULT FALSE,
    is_fragile BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_logs (
    id UUID PRIMARY KEY,
    shipment_id UUID REFERENCES shipments(id),
    status VARCHAR(50) NOT NULL,
    location_lat FLOAT,
    location_lng FLOAT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    index INTEGER NOT NULL,
    previous_hash VARCHAR(64) NOT NULL,
    log_hash VARCHAR(64) NOT NULL,
    metadata_json JSON DEFAULT '{}'
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_spark_id ON vehicles(spark_id);
CREATE INDEX IF NOT EXISTS idx_tracking_id ON shipments(tracking_id);
CREATE INDEX IF NOT EXISTS idx_user_email ON users(email);

COMMIT;
