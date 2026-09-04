/**
 * Password hashing. Auth.js does not hash passwords for the Credentials
 * provider — that is the application's job. We use bcrypt (pure-JS build so it
 * runs on Vercel without native bindings) with a cost factor of 12.
 *
 * No `server-only` import here on purpose: prisma/seed.ts and tests use it too.
 */
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

/** A real hash of a random string, used to equalise timing when the user doesn't exist. */
const DUMMY_HASH = "$2b$12$BA4Hj7CzKzgQlOMIP5tvkuuki8gthI/gfdpiTqh/fOU6UsSUIUgP6";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  // Always run a compare so response time doesn't reveal whether the account exists.
  return bcrypt.compare(plain, hash ?? DUMMY_HASH).then((ok) => ok && Boolean(hash));
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
