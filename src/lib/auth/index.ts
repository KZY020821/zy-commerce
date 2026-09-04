/**
 * Auth.js (NextAuth v5) configuration.
 *
 * - Credentials provider only (spec §5); OAuth is a stretch goal.
 * - JWT sessions (required by the Credentials provider). Cookies are host-only,
 *   so a session on acme.<root> is invisible on beta.<root> and on the root.
 * - The tenant is resolved from the request Host inside `authorize`, so a
 *   login on acme.<root> can only ever match acme's users. Super admins log in
 *   on the root domain (tenantId IS NULL).
 * - Rate limiting lives here rather than in the Server Action so the built-in
 *   /api/auth/callback/credentials endpoint is covered too.
 * - Role checks at request time are done in `guards.ts` against the database,
 *   not the token (spec §5, §9).
 */
import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { UserRole } from "@/generated/prisma/enums";
import { unscopedDb } from "@/lib/db/prisma";
import { requestHost, resolveTenantSlug } from "@/lib/tenant/resolve";
import { verifyPassword } from "./password";
import { RATE_LIMITS, checkRateLimit, clientIpFromHeaders } from "./rate-limit";

export class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid_credentials";
}

export class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1).max(128),
  /** Which kind of account this login form is for. Never elevates — only filters. */
  role: z.enum(UserRole),
});

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  logger: {
    // Failed logins are expected traffic, not application errors; keep them out of error logs.
    error(error) {
      if (error instanceof CredentialsSignin) return;
      console.error("[auth]", error);
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        role: { type: "hidden" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentialsError();
        const { email, password, role } = parsed.data;

        const ip = clientIpFromHeaders(request.headers);
        if (!checkRateLimit(`login:ip:${ip}`, RATE_LIMITS.loginPerIp).ok) throw new RateLimitedError();
        if (!checkRateLimit(`login:acct:${ip}:${email}`, RATE_LIMITS.loginPerAccount).ok) throw new RateLimitedError();

        const slug = resolveTenantSlug(requestHost(request.headers));

        let user: { id: string; email: string; name: string | null; role: UserRole; tenantId: string | null; passwordHash: string } | null = null;

        if (slug === null) {
          // Platform root: only super admins may authenticate here.
          if (role !== UserRole.SUPER_ADMIN) throw new InvalidCredentialsError();
          user = await unscopedDb.user.findFirst({
            where: { tenantId: null, email, role: UserRole.SUPER_ADMIN },
            select: { id: true, email: true, name: true, role: true, tenantId: true, passwordHash: true },
          });
        } else {
          if (role === UserRole.SUPER_ADMIN) throw new InvalidCredentialsError();
          const tenant = await unscopedDb.tenant.findUnique({ where: { slug }, select: { id: true, status: true } });
          if (!tenant || tenant.status !== "ACTIVE") throw new InvalidCredentialsError();
          user = await unscopedDb.user.findUnique({
            where: { tenantId_email: { tenantId: tenant.id, email } },
            select: { id: true, email: true, name: true, role: true, tenantId: true, passwordHash: true },
          });
        }

        // verifyPassword always runs a bcrypt compare (dummy hash when no user) to
        // keep timing uniform. Role mismatch is checked after the compare for the same reason.
        const ok = await verifyPassword(password, user?.passwordHash);
        if (!ok || !user || user.role !== role) throw new InvalidCredentialsError();

        return { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      if (token.role) session.user.role = token.role;
      session.user.tenantId = token.tenantId ?? null;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
