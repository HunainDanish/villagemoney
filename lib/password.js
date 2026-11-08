import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

// scrypt parameters: N=2^14, r=8, p=1, 64-byte key (~16 MB, ~50 ms).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function passwordProblem(pw) {
  if (typeof pw !== 'string') return 'Enter a password';
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (pw.length > PASSWORD_MAX) return 'That password is too long';
  return null;
}

// "scrypt$N$r$p$salt$hash" (base64url). The format records its own
// parameters, so they can be raised later without breaking old hashes.
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || typeof stored !== 'string') return false;
  const [kind, n, r, p, saltB64, keyB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used when the username doesn't exist, so a wrong username takes as long as
// a wrong password (no way to probe which usernames have accounts).
let dummy = null;
export async function burnTime(pw) {
  dummy ||= await hashPassword('not-a-real-password');
  await verifyPassword(typeof pw === 'string' ? pw : '', dummy);
}
