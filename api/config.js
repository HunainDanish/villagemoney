import { hasDb } from '../lib/db.js';
import { json, cdn } from '../lib/http.js';
import { normalizeUsername } from '../shared/layout.js';

// Accept IG_HANDLE as "name", "@name", " name ", or a full profile URL.
export function cleanHandle(raw = '') {
  const m = String(raw).trim().match(/instagram\.com\/([^/?#\s]+)/i);
  return normalizeUsername(m ? m[1] : raw) || '';
}

// Public settings for the browser. The anon key is safe to expose: RLS blocks
// it from every table, and it is only used for realtime walking positions.
export function GET() {
  return json(
    {
      demo: !hasDb(),
      townName: process.env.TOWN_NAME || 'Porchlight',
      igHandle: cleanHandle(process.env.IG_HANDLE),
      supabaseUrl: process.env.SUPABASE_URL || '',
      // Newer "publishable" key (sb_publishable_...) or the legacy anon key.
      supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
    },
    { cache: cdn(300) },
  );
}
