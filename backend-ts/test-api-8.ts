import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("No DATABASE_URL found");
    return;
  }
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log("Connected to db");
    await client.query(`ALTER TABLE public.capacity_bids ADD COLUMN IF NOT EXISTS dropoff_point_id UUID REFERENCES public.delivery_points(id);`);
    console.log("Added column");
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log("Reloaded schema cache");
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
