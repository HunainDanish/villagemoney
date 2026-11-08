// Several endpoints served by one Vercel function. The free (Hobby) plan
// allows at most 12 functions per deployment, so small related endpoints
// share one dynamic route, e.g. api/auth/[action].js serves
// /api/auth/login, /api/auth/logout, /api/auth/password and /api/auth/redeem.
// URLs are unchanged.

const notFound = () =>
  new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
const notAllowed = () =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });

export function router(routes) {
  const handle = (method) => (request) => {
    const name = new URL(request.url).pathname.split('/').filter(Boolean).pop();
    const mod = Object.hasOwn(routes, name) ? routes[name] : null;
    if (!mod) return notFound();
    if (typeof mod[method] !== 'function') return notAllowed();
    return mod[method](request);
  };
  return { GET: handle('GET'), POST: handle('POST'), PATCH: handle('PATCH'), DELETE: handle('DELETE') };
}
