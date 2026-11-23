import { db } from './db.js';

// The newest Instagram token: the one the weekly refresh stored, or the one
// from IG_ACCESS_TOKEN until the first refresh has run.
let cached = null;

export async function igToken() {
  if (cached && cached.at > Date.now() - 10 * 60e3) return cached.value;
  const { data } = await db().from('app_tokens').select('value').eq('name', 'instagram').maybeSingle();
  const value = data?.value || process.env.IG_ACCESS_TOKEN;
  cached = { value, at: Date.now() };
  return value;
}

// Long-lived tokens last 60 days and can be refreshed once they are 24 h old.
export async function refreshIgToken() {
  const current = await igToken();
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`,
  );
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  const { error } = await db()
    .from('app_tokens')
    .upsert({ name: 'instagram', value: access_token, expires_at, updated_at: new Date().toISOString() });
  if (error) throw error;
  cached = { value: access_token, at: Date.now() };
  return expires_at;
}
