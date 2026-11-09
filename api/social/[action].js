import { hasDb } from '../../lib/db.js';
import { errorJson } from '../../lib/http.js';
import { handleSocial } from '../../lib/social.js';

// /api/social/list | friend | accept | remove | rival | movein | gift | raid | seen
// (one Vercel function; see lib/social.js)
export function GET(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  return handleSocial(request, 'GET');
}

export function POST(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  return handleSocial(request, 'POST');
}
