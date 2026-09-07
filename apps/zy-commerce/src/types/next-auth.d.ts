import type { UserRole } from "@/generated/prisma/enums";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      tenantId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    tenantId: string | null;
  }
}

// `next-auth/jwt` is a bare re-export of `@auth/core/jwt`, so the JWT interface
// has to be augmented at its source for the callbacks to see the extra claims.
declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    role?: UserRole;
    tenantId?: string | null;
  }
}
