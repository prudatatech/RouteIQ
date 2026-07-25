-- ==============================================================================
-- RouteIQ Supabase Initialization Script
-- ==============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ==============================================================================
-- ENUMS
-- ==============================================================================
CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'manager', 'driver');
CREATE TYPE vehicle_type AS ENUM ('truck', 'van', 'bike', 'car');
CREATE TYPE vehicle_status AS ENUM ('available', 'on_route', 'idle', 'maintenance', 'offline');
CREATE TYPE route_status AS ENUM ('pending', 'optimizing', 'active', 'completed', 'cancelled');
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE shipment_status AS ENUM ('created', 'picked_up', 'in_transit', 'delivered', 'cancelled');
CREATE TYPE shipment_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE invoice_status AS ENUM ('unpaid', 'paid', 'overdue', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- ==============================================================================
-- TABLES
-- ==============================================================================

-- 1. USERS (Tied to auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    hashed_password VARCHAR(255), -- Maintained for backward compatibility with existing SQLAlchemy model if needed
    role user_role DEFAULT 'driver'::user_role NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_users_email ON users(email);

-- Auth Trigger: Automatically create public.users row when a new user signs up in Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'full_name', 'New User'), 'driver');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- 2. VEHICLES
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plate_number VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type vehicle_type DEFAULT 'truck'::vehicle_type NOT NULL,
    capacity_kg FLOAT DEFAULT 1000 NOT NULL,
    fuel_type VARCHAR(20) DEFAULT 'diesel' NOT NULL,
    fuel_capacity_liters FLOAT DEFAULT 60.0 NOT NULL,
    fuel_efficiency_kmpl FLOAT DEFAULT 12.0 NOT NULL,
    current_fuel_liters FLOAT DEFAULT 60.0 NOT NULL,
    status vehicle_status DEFAULT 'available'::vehicle_status NOT NULL,
    latitude FLOAT,
    longitude FLOAT,
    last_heartbeat TIMESTAMPTZ,
    spark_id VARCHAR(50),
    last_sync TIMESTAMPTZ,
    driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_vehicles_spark_id ON vehicles(spark_id);

-- 3. DEPOTS
CREATE TABLE depots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0 NOT NULL,
    heading FLOAT DEFAULT 0.0 NOT NULL,
    fuel_level_pct FLOAT DEFAULT 100.0 NOT NULL,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. SHIPMENTS
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_id VARCHAR(50) UNIQUE NOT NULL,
    status shipment_status DEFAULT 'created'::shipment_status NOT NULL,
    priority shipment_priority DEFAULT 'medium'::shipment_priority NOT NULL,
    origin_name VARCHAR(255),
    origin_address TEXT,
    origin_lat FLOAT,
    origin_lng FLOAT,
    total_items INTEGER DEFAULT 1,
    total_weight_kg FLOAT DEFAULT 0.0,
    received_by VARCHAR(100),
    signature_data TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_shipments_tracking_id ON shipments(tracking_id);

-- 5. DELIVERY POINTS
CREATE TABLE delivery_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0 NOT NULL,
    heading FLOAT DEFAULT 0.0 NOT NULL,
    fuel_level_pct FLOAT DEFAULT 100.0 NOT NULL,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSONB DEFAULT '[]'::jsonb NOT NULL,
    demand_kg FLOAT DEFAULT 0.0 NOT NULL,
    service_time_minutes INTEGER DEFAULT 10 NOT NULL,
    required_cargo_types JSONB DEFAULT '[]'::jsonb NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' NOT NULL,
    shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. ROUTES
CREATE TABLE routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    depot_id UUID NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
    status route_status DEFAULT 'pending'::route_status NOT NULL,
    total_distance_km FLOAT DEFAULT 0.0 NOT NULL,
    total_duration_minutes FLOAT DEFAULT 0.0 NOT NULL,
    estimated_fuel_liters FLOAT DEFAULT 0.0 NOT NULL,
    weather_condition VARCHAR(50) DEFAULT 'clear' NOT NULL,
    traffic_delay_minutes INTEGER DEFAULT 0 NOT NULL,
    waypoints JSONB DEFAULT '[]'::jsonb NOT NULL,
    optimization_score FLOAT DEFAULT 0.0 NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 7. ROUTE STOPS
CREATE TABLE route_stops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    delivery_point_id UUID NOT NULL REFERENCES delivery_points(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 8. TELEMETRY
CREATE TABLE telemetry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0 NOT NULL,
    heading FLOAT DEFAULT 0.0 NOT NULL,
    fuel_level_pct FLOAT DEFAULT 100.0 NOT NULL,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSONB DEFAULT '[]'::jsonb NOT NULL
);

-- 9. VEHICLE STOPPAGES
CREATE TABLE vehicle_stoppages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    end_time TIMESTAMPTZ,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed_kmph FLOAT DEFAULT 0.0 NOT NULL,
    heading FLOAT DEFAULT 0.0 NOT NULL,
    fuel_level_pct FLOAT DEFAULT 100.0 NOT NULL,
    engine_temp FLOAT,
    odometer_km FLOAT,
    cargo_types JSONB DEFAULT '[]'::jsonb NOT NULL,
    reason VARCHAR(255) DEFAULT 'unknown' NOT NULL,
    duration_minutes INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 10. MAINTENANCE ALERTS
CREATE TABLE maintenance_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity alert_severity DEFAULT 'medium'::alert_severity NOT NULL,
    description TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 11. PARCELS
CREATE TABLE parcels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    weight_kg FLOAT NOT NULL,
    length_cm FLOAT NOT NULL,
    width_cm FLOAT NOT NULL,
    height_cm FLOAT NOT NULL,
    category VARCHAR(50) NOT NULL,
    is_hazardous BOOLEAN DEFAULT FALSE NOT NULL,
    is_fragile BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 12. SHIPMENT LOGS
CREATE TABLE shipment_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    location_lat FLOAT,
    location_lng FLOAT,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    index INTEGER NOT NULL,
    previous_hash VARCHAR(64) NOT NULL,
    log_hash VARCHAR(64) NOT NULL,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    -- No updated_at for logs since they are append-only usually, but SQLAlchemy model doesn't specify TimestampMixin
    CONSTRAINT uk_shipment_log_index UNIQUE (shipment_id, index)
);

-- 13. INVOICES
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    amount FLOAT NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD' NOT NULL,
    status invoice_status DEFAULT 'unpaid'::invoice_status NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);

-- 14. PAYMENTS
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount FLOAT NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    status payment_status DEFAULT 'pending'::payment_status NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 15. AI AGENT LOGS
CREATE TABLE ai_agent_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_name VARCHAR(100) NOT NULL,
    task_description TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    result TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'success' NOT NULL,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Trigger to handle updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
DECLARE
    t_name text;
BEGIN
    FOR t_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') 
    LOOP
        -- Check if updated_at exists in the table
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t_name AND column_name = 'updated_at') THEN
            EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t_name, t_name);
        END IF;
    END LOOP;
END;
$$;
