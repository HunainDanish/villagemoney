import { router } from '../../lib/router.js';
import * as create from '../../lib/handlers/admin/create.js';
import * as residents from '../../lib/handlers/admin/residents.js';
import * as refresh from '../../lib/handlers/admin/refresh.js';

// /api/admin/create | residents | refresh (one function on Vercel).
export const { GET, POST, PATCH, DELETE } = router({ create, residents, refresh });
