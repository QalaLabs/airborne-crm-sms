import { hash, verify } from "argon2";
import { prisma } from "@/lib/db/client";
import { UserRepository } from "@/lib/repositories/user.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { generateInviteToken, sha256 } from "@/lib/utils/crypto";
import { inviteLink, sendInviteEmail } from "@/lib/services/invite-email";
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from "@/lib/utils/errors";
import type { InviteUserInput, CreateUserInput, UpdateUserInput, UserFilters, ForgotPasswordInput } from "@/lib/validations/user.schema";
import type { RequestContext } from "@/types";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export class UserService {
  static async list(ctx: RequestContext, filters: UserFilters) {
    return UserRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const user = await UserRepository.findById(ctx.orgId, id);
    if (!user) throw new NotFoundError("User", id);
    return user;
  }

  static async invite(ctx: RequestContext, input: InviteUserInput, origin?: string) {
    const existing = await UserRepository.findByEmail(ctx.orgId, input.email);
    if (existing) throw new ConflictError(`User with email ${input.email} already exists`);

    // Only SUPER_ADMIN may invite SUPER_ADMIN.
    if (input.role === "SUPER_ADMIN" && ctx.user.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("assign", "SUPER_ADMIN");
    }

    const rawToken = generateInviteToken();
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const user = await UserRepository.create(ctx.orgId, {
      email: input.email,
      name: input.name,
      role: input.role,
      campusId: input.campusId,
      phone: input.phone,
      inviteToken: sha256(rawToken),
      inviteExpiry,
      isActive: false,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "user.invited",
      entityType: "user",
      entityId: user.id,
      newValue: { email: input.email, role: input.role, invitedAt: new Date().toISOString() },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "invited",
      objectType: "user",
      objectId: user.id,
      objectSnapshot: { email: input.email, role: input.role },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "user/invited",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { userId: user.id, email: input.email, role: input.role },
    });

    const link = inviteLink(rawToken, origin);
    const email = await sendInviteEmail({ to: input.email, name: input.name, role: input.role, link });

    return { ...user, inviteToken: rawToken, inviteLink: link, emailStatus: email.status, emailError: email.errorMsg };
  }

  static async create(ctx: RequestContext, input: CreateUserInput) {
    const existing = await UserRepository.findByEmail(ctx.orgId, input.email);
    if (existing) throw new ConflictError(`User with email ${input.email} already exists`);

    // Only SUPER_ADMIN may create SUPER_ADMIN.
    if (input.role === "SUPER_ADMIN" && ctx.user.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("assign", "SUPER_ADMIN");
    }

    const passwordHash = await hash(input.password);

    const user = await UserRepository.create(ctx.orgId, {
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      campusId: input.campusId,
      phone: input.phone,
      avatarUrl: input.avatarUrl,
      isActive: true,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      newValue: { email: user.email, role: user.role },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "user",
      objectId: user.id,
      objectSnapshot: { name: user.name, role: user.role },
      context: { actorName: ctx.user.name },
    });

    return user;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateUserInput) {
    // Reactivation targets a soft-deleted account, so include deleted rows for it.
    const existing =
      input.isActive === true
        ? await UserRepository.findByIdIncludingDeleted(ctx.orgId, id)
        : await this.getById(ctx, id);
    if (!existing) throw new NotFoundError("User", id);

    // Only SUPER_ADMIN can change roles.
    if (input.role && ctx.user.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("change role", "user");
    }

    // A SUPER_ADMIN may not change their own role (prevents self-demotion lockout).
    if (input.role && ctx.user.id === id) {
      throw new ForbiddenError("change role", "own account");
    }

    // Users can update their own profile (non-role fields).
    const isSelf = ctx.user.id === id;
    if (!isSelf && ctx.user.role !== "SUPER_ADMIN" && ctx.user.role !== "ADMIN") {
      throw new ForbiddenError("update", "user");
    }

    // Protect the last active SUPER_ADMIN from demotion or deactivation.
    if (existing.role === "SUPER_ADMIN") {
      const demoted = input.role && input.role !== "SUPER_ADMIN";
      const deactivated = input.isActive === false;
      if ((demoted || deactivated) && ctx.user.id !== id) {
        const activeSuperAdmins = await UserRepository.countActiveSuperAdmins(ctx.orgId);
        if (activeSuperAdmins <= 1) {
          throw new ConflictError("Cannot remove the last active Super Admin");
        }
      }
    }

    const updated = await UserRepository.update(ctx.orgId, id, {
      ...(input.name && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
      ...(input.campusId !== undefined && { campusId: input.campusId }),
      ...(input.role && { role: input.role }),
      ...(typeof input.isActive === "boolean" && { isActive: input.isActive }),
      ...(input.isActive === true && { deletedAt: null }),
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "user.updated",
      entityType: "user",
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });

    if (input.role && existing.role !== input.role) {
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        action: "user.role_changed",
        entityType: "user",
        entityId: id,
        oldValue: { role: existing.role },
        newValue: { role: input.role },
      });
    }

    if (typeof input.isActive === "boolean" && existing.isActive !== input.isActive) {
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        action: input.isActive ? "user.reactivated" : "user.deactivated",
        entityType: "user",
        entityId: id,
        oldValue: { isActive: existing.isActive },
        newValue: { isActive: input.isActive },
      });
    }

    return updated;
  }

  static async updateSelfProfile(
    ctx: RequestContext,
    input: {
      name?: string;
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      avatarUrl?: string | null;
    },
  ) {
    const derivedName =
      input.firstName !== undefined || input.lastName !== undefined
        ? `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim()
        : input.name;

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: ctx.user.id },
        data: {
          ...(derivedName !== undefined ? { name: derivedName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          campusId: true,
        },
      });

      // Portal cadets edit the linked Student record — keep both in sync.
      if (ctx.user.role === "STUDENT") {
        const student = await tx.student.findFirst({
          where: { orgId: ctx.orgId, userId: ctx.user.id, deletedAt: null, status: "ACTIVE" },
          select: { id: true },
        });
        if (student) {
          await tx.student.update({
            where: { id: student.id },
            data: {
              ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
              ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
              ...(input.phone !== undefined ? { phone: input.phone ?? "" } : {}),
            },
          });
        }
      }

      return user;
    });
  }

  static async deactivate(ctx: RequestContext, id: string) {
    const user = await this.getById(ctx, id);

    // Cannot deactivate yourself.
    if (ctx.user.id === id) {
      throw new ForbiddenError("deactivate", "own account");
    }

    // Protect the last active SUPER_ADMIN.
    if (user.role === "SUPER_ADMIN") {
      const activeSuperAdmins = await UserRepository.countActiveSuperAdmins(ctx.orgId);
      if (activeSuperAdmins <= 1) {
        throw new ConflictError("Cannot deactivate the last active Super Admin");
      }
    }

    await UserRepository.softDelete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "user.deactivated",
      entityType: "user",
      entityId: id,
      oldValue: { isActive: true },
      newValue: { isActive: false },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "deactivated",
      objectType: "user",
      objectId: id,
      objectSnapshot: { name: user.name },
      context: { actorName: ctx.user.name },
    });

    return { ok: true };
  }

  static async acceptInvite(token: string, password: string) {
    const user = await UserRepository.findByInviteToken(token);
    if (!user) throw new NotFoundError("Invite", token);

    const passwordHash = await hash(password);
    const accepted = await UserRepository.acceptInvite(user.id, passwordHash);

    await AuditService.write({
      orgId: user.orgId,
      userId: user.id,
      action: "user.activated",
      entityType: "user",
      entityId: user.id,
      newValue: { email: user.email, role: user.role, activatedAt: new Date().toISOString() },
    });

    return accepted;
  }

  static async changePassword(
    ctx: RequestContext,
    id: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await UserRepository.findByIdWithPassword(ctx.orgId, id);
    if (!user) throw new NotFoundError("User", id);
    if (!user.passwordHash) {
      throw new ValidationError(["Account has no password set — use the invitation or reset flow."]);
    }

    const valid = await verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new ValidationError(["Current password is incorrect"]);
    }

    const passwordHash = await hash(newPassword);
    await UserRepository.setPassword(ctx.orgId, id, passwordHash);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "user.password_changed",
      entityType: "user",
      entityId: id,
      newValue: { changedAt: new Date().toISOString() },
    });

    return { ok: true };
  }

  static async requestPasswordReset(input: ForgotPasswordInput) {
    const genericMessage =
      "If an account exists for that email, a password reset link has been sent.";

    const org = await prisma.organization.findUnique({
      where: { slug: input.orgSlug },
      select: { id: true },
    });
    if (!org) return { message: genericMessage };

    const user = await UserRepository.findByEmailWithPassword(org.id, input.email);
    if (!user) return { message: genericMessage };

    const rawToken = generateInviteToken();
    const tokenHash = sha256(rawToken);
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    // One active reset token per user — rotate any existing token.
    await prisma.verificationToken.deleteMany({ where: { identifier: user.id } });
    await prisma.verificationToken.create({
      data: { identifier: user.id, token: tokenHash, expires },
    });

    await AuditService.write({
      orgId: org.id,
      userId: user.id,
      action: "user.password_reset_requested",
      entityType: "user",
      entityId: user.id,
      newValue: { requestedAt: new Date().toISOString(), expiresAt: expires.toISOString() },
    });

    return { message: genericMessage };
  }

  static async resetPassword(input: { token: string; password: string }) {
    const tokenHash = sha256(input.token);

    const record = await prisma.verificationToken.findUnique({
      where: { token: tokenHash },
    });
    if (!record) throw new NotFoundError("Reset token");

    // Expired tokens are consumed immediately so they cannot be retried.
    if (record.expires < new Date()) {
      await prisma.verificationToken
        .delete({ where: { token: tokenHash } })
        .catch(() => {});
      throw new NotFoundError("Reset token");
    }

    const user = await prisma.user.findFirst({
      where: { id: record.identifier, deletedAt: null },
      select: { id: true, orgId: true },
    });
    if (!user) {
      await prisma.verificationToken
        .delete({ where: { token: tokenHash } })
        .catch(() => {});
      throw new NotFoundError("Reset token");
    }

    const passwordHash = await hash(input.password);
    await UserRepository.setPassword(user.orgId, user.id, passwordHash);

    // One-time use — consume the token.
    await prisma.verificationToken.delete({ where: { token: tokenHash } });

    await AuditService.write({
      orgId: user.orgId,
      userId: user.id,
      action: "user.password_reset",
      entityType: "user",
      entityId: user.id,
      newValue: { resetAt: new Date().toISOString() },
    });

    return { ok: true };
  }
}
