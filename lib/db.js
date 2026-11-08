import { createClient } from '@supabase/supabase-js';

// One client per function instance. Supabase talks over HTTPS (PostgREST), so
// thousands of concurrent serverless invocations never exhaust a Postgres
// connection pool the way a raw `pg` connection per invocation would.
let client = null;

// Supabase's newer "secret" key (sb_secret_...) or the legacy service_role key.
const serverKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

export function hasDb() {
  return Boolean(process.env.SUPABASE_URL && serverKey());
}

export function db() {
  if (!hasDb()) throw new Error('Database is not configured');
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function getOrCreateResident(username, source, igUserId = null) {
  const { data, error } = await db().rpc('get_or_create_resident', {
    p_username: username,
    p_source: source,
    p_ig_user_id: igUserId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
