// Small helpers for Vercel Web-standard functions (Request -> Response).

export function json(data, { status = 200, cache = 'no-store', headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...headers },
  });
}

export const errorJson = (message, status = 400) => json({ error: message }, { status });

// Public, CDN-cacheable responses. Vercel's edge serves repeats for `s` seconds
// without invoking the function, which is what keeps a viral spike cheap.
export const cdn = (s, swr = s * 10) => `public, max-age=0, s-maxage=${s}, stale-while-revalidate=${swr}`;

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setCookie(name, value, { maxAge, httpOnly = true } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax', 'Secure'];
  if (httpOnly) bits.push('HttpOnly');
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  return bits.join('; ');
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function siteOrigin(request) {
  return process.env.PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(request.url).origin;
}
