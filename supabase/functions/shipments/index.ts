import { createClient } from 'https://esm.sh/@supabase/supabase-js';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, ''); // remove leading slash
  const method = req.method;

  // Simple stub implementation
  const response = { module: 'shipments', method, path, message: 'Stub response for shipments Edge Function' };
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
