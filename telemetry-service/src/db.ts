import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let connectionString = process.env.DATABASE_URL || 'postgresql://routeiq:routeiq_pass@127.0.0.1:5433/routeiq';

// Clean up +asyncpg python specific dialect if present
if (connectionString.includes('+asyncpg')) {
  connectionString = connectionString.replace('+asyncpg', '');
}

export const pool = new pg.Pool({
  connectionString,
  max: 10, // Keep connection count reasonable
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});
