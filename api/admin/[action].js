import { router } from '../../lib/router.js';
import * as create from '../../lib/handlers/admin/create.js';
import * as residents from '../../lib/handlers/admin/residents.js';

// /api/admin/create | residents (one function on Vercel).
export const { GET, POST, PATCH, DELETE } = router({ create, residents });
