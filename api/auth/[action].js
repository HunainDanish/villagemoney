import { router } from '../../lib/router.js';
import * as login from '../../lib/handlers/auth/login.js';
import * as logout from '../../lib/handlers/auth/logout.js';
import * as password from '../../lib/handlers/auth/password.js';
import * as redeem from '../../lib/handlers/auth/redeem.js';

// /api/auth/login | logout | password | redeem (one function on Vercel).
export const { GET, POST, PATCH, DELETE } = router({ login, logout, password, redeem });
