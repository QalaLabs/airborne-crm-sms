import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { NotFoundError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

export const INTEGRATION_PROVIDERS = ["GOOGLE_ADS", "JOBS_FEED"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const KEY_VALIDITY_OPTIONS = ["1", "3", "7", "15", "30", "45", "60", "never"] as const;
export type KeyValidity = (typeof KEY_VALIDITY_OPTIONS)[number];

export const createIntegrationKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  validity: z.enum(KEY_VALIDITY_OPTIONS),
});
export type CreateIntegrationKeyInput = z.infer<typeof createIntegrationKeySchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function expiryFor(validity: KeyValidity, now: Date = new Date()): Date | null {
  if (validity === "never") return null;
  return new Date(now.getTime() + Number(validity) * DAY_MS);
}

export function hashIntegrationKey(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

export function keyStatus(
  key: { expiresAt: Date | null; revokedAt: Date | null },
  now: Date = new Date(),
): "active" | "expired" | "revoked" {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

const KEY_SELECT = {
  id: true,
  provider: true,
  name: true,
  keyPreview: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

export class IntegrationKeyService {
  static async list(ctx: RequestContext, provider: IntegrationProvider) {
    const keys = await prisma.integrationKey.findMany({
      where: { orgId: ctx.orgId, provider },
      select: KEY_SELECT,
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    return keys.map((k) => ({ ...k, status: keyStatus(k, now) }));
  }

  /** Returns the raw key exactly once; only its hash is persisted. */
  static async create(ctx: RequestContext, provider: IntegrationProvider, input: CreateIntegrationKeyInput) {
    const raw = randomUUID();
    const expiresAt = expiryFor(input.validity);
    const key = await prisma.integrationKey.create({
      data: {
        orgId: ctx.orgId,
        provider,
        name: input.name,
        keyHash: hashIntegrationKey(raw),
        keyPreview: `${raw.slice(0, 8)}...${raw.slice(-4)}`,
        expiresAt,
        createdBy: ctx.user.id,
      },
      select: KEY_SELECT,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "integration_key.created",
      entityType: "integration_key",
      entityId: key.id,
      newValue: { provider, name: key.name, validity: input.validity, expiresAt: expiresAt?.toISOString() ?? null },
    });

    return { ...key, status: keyStatus(key), key: raw };
  }

  static async revoke(ctx: RequestContext, provider: IntegrationProvider, id: string) {
    const existing = await prisma.integrationKey.findFirst({
      where: { id, orgId: ctx.orgId, provider },
      select: KEY_SELECT,
    });
    if (!existing) throw new NotFoundError("IntegrationKey", id);
    if (existing.revokedAt) return { ...existing, status: keyStatus(existing) };

    const key = await prisma.integrationKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: KEY_SELECT,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "integration_key.revoked",
      entityType: "integration_key",
      entityId: id,
      oldValue: { name: existing.name, status: keyStatus(existing) },
      newValue: { status: "revoked" },
    });

    return { ...key, status: keyStatus(key) };
  }

  static async hasActiveKey(orgId: string, provider: IntegrationProvider): Promise<boolean> {
    const count = await prisma.integrationKey.count({
      where: {
        orgId,
        provider,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return count > 0;
  }

  /** True when `raw` matches an unrevoked, unexpired key of this org/provider. */
  static async verify(orgId: string, provider: IntegrationProvider, raw: string | undefined | null): Promise<boolean> {
    return (await this.authenticate(orgId, provider, raw)) !== null;
  }

  /** Like verify, but returns the matching key (id, name, creator) for attribution. */
  static async authenticate(
    orgId: string,
    provider: IntegrationProvider,
    raw: string | undefined | null,
  ): Promise<{ id: string; name: string; createdBy: string | null } | null> {
    if (!raw || !raw.trim()) return null;
    const key = await prisma.integrationKey.findUnique({
      where: { keyHash: hashIntegrationKey(raw) },
      select: { id: true, orgId: true, provider: true, name: true, createdBy: true, expiresAt: true, revokedAt: true },
    });
    if (!key || key.orgId !== orgId || key.provider !== provider) return null;
    if (keyStatus(key) !== "active") return null;

    await prisma.integrationKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { id: key.id, name: key.name, createdBy: key.createdBy ?? null };
  }
}
