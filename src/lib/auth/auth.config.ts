import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@prisma/client";
import type { SessionUser } from "@/types";

// Edge-safe auth config — no Node.js-only modules (no argon2, no prisma adapter)
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as SessionUser;
        token.id = u.id;
        token.orgId = u.orgId;
        token.campusId = u.campusId;
        token.role = u.role as UserRole;
        token.avatarUrl = u.avatarUrl;
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        id: token.id as string,
        orgId: token.orgId as string,
        campusId: (token.campusId as string | null) ?? null,
        name: token.name ?? "",
        email: token.email ?? "",
        role: token.role as UserRole,
        avatarUrl: (token.avatarUrl as string | null) ?? null,
      } as SessionUser & typeof session.user;
      return session;
    },
  },
};
