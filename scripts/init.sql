-- RouteIQ Database Initialization
-- Runs on first postgres startup via docker-entrypoint-initdb.d

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for text search on addresses

-- Seed admin user (password: Admin1234!)
-- NOTE: Run after alembic migrations via:
--   docker compose exec backend python -c "from app.core.db import *; ..."
-- Or use the psql command below after migrations:
-- INSERT INTO users (id, email, full_name, hashed_password, role, is_active) VALUES
--   (uuid_generate_v4(), 'admin@routeiq.io', 'System Admin',
--    '$2b$12$fS.L48I2wKXFElnS6BeAytdUEJBlrGyfNDY9nWh6xR5uH0uBoh5R.', 'admin', true);

-- Sample depot in Delhi
-- INSERT INTO depots (id, name, address, latitude, longitude) VALUES
--   (uuid_generate_v4(), 'Delhi Central Hub',
--    'Connaught Place, New Delhi', 28.6139, 77.2090);
