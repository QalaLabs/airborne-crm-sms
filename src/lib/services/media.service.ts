import { v4 as uuid } from "uuid";
import { MediaRepository, MediaFolderRepository } from "@/lib/repositories/media.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "@/lib/utils/errors";
import {
  isStorageConfigured,
  uploadObject,
  deleteObject,
  createSignedUploadUrl,
  getPublicUrl,
} from "@/lib/storage/gcs";
import {
  MAX_MEDIA_FILE_SIZE,
  isAllowedMediaType,
} from "@/lib/validations/media.schema";
import type {
  RegisterAssetInput,
  UpdateAssetInput,
  ReplaceAssetInput,
  PresignMediaInput,
  AssetFilters,
  CreateFolderInput,
  UpdateFolderInput,
} from "@/lib/validations/media.schema";
import type { RequestContext } from "@/types";

// ─── MediaService ─────────────────────────────────────────────────────────────

export interface UploadFileInput {
  originalName: string;
  name?: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Uint8Array;
  folderId?: string;
  altText?: string;
  tags?: string[];
}

function buildFileKey(orgId: string, originalName: string): string {
  const ext = originalName.split(".").pop() ?? "bin";
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "bin";
  return `media/${orgId}/${Date.now()}-${uuid()}.${safeExt}`;
}

export class MediaService {
  static async list(ctx: RequestContext, filters: AssetFilters) {
    return MediaRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const asset = await MediaRepository.findById(ctx.orgId, id);
    if (!asset) throw new NotFoundError("MediaAsset", id);
    return asset;
  }

  // Signed upload URL (Supabase) — client PUTs bytes directly to storage, then
  // calls register() or replace() to persist the record.
  static async getPresignedUrl(
    ctx: RequestContext,
    input: PresignMediaInput,
  ): Promise<{ uploadUrl: string; fileKey: string; fileUrl: string }> {
    // M-05: reject unlisted MIME types before minting a signed upload URL.
    if (!isAllowedMediaType(input.contentType)) {
      throw new ValidationError([{ message: `File type "${input.contentType}" is not supported` }]);
    }
    const fileKey = buildFileKey(ctx.orgId, input.fileName);
    const uploadUrl = await createSignedUploadUrl(fileKey, input.contentType);

    return { uploadUrl, fileKey, fileUrl: getPublicUrl(fileKey) };
  }

  // Full upload: authorize → validate → Supabase Storage upload → persist.
  // Storage failures surface before any MediaAsset row is created.
  static async upload(ctx: RequestContext, input: UploadFileInput) {
    if (!isAllowedMediaType(input.mimeType)) {
      throw new ValidationError([{ message: `File type "${input.mimeType}" is not supported` }]);
    }
    if (input.sizeBytes <= 0) {
      throw new ValidationError([{ message: "Uploaded file is empty" }]);
    }
    if (input.sizeBytes > MAX_MEDIA_FILE_SIZE) {
      throw new ValidationError([
        { message: `File exceeds the ${MAX_MEDIA_FILE_SIZE / 1024 / 1024}MB upload limit` },
      ]);
    }

    let folderId: string | undefined;
    if (input.folderId) {
      const folder = await MediaFolderRepository.findById(ctx.orgId, input.folderId);
      if (!folder) throw new NotFoundError("MediaFolder", input.folderId);
      folderId = input.folderId;
    }

    const fileKey = buildFileKey(ctx.orgId, input.originalName);
    const fileUrl = await uploadObject(fileKey, input.buffer, input.mimeType);

    try {
      const asset = await MediaRepository.create(ctx.orgId, ctx.user.id, {
        name: input.name ?? input.originalName,
        originalName: input.originalName,
        fileKey,
        fileUrl,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        altText: input.altText,
        tags: input.tags ?? [],
        folderId,
        metadata: {},
      });

      // Durable audit/activity owned by the sync upload path (Inngest-independent)
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        action: "media.uploaded",
        entityType: "media_asset",
        entityId: asset.id,
        newValue: { name: asset.name, mimeType: asset.mimeType, folderId: asset.folderId ?? undefined },
      });

      await ActivityFeedService.write({
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        verb: "uploaded",
        objectType: "media_asset",
        objectId: asset.id,
        objectSnapshot: { name: asset.name, mimeType: asset.mimeType },
        context: { actorName: ctx.user.name },
      });

      await emitEvent({
        name: "media/uploaded",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: {
          assetId: asset.id,
          name: asset.name,
          mimeType: asset.mimeType,
          folderId: asset.folderId ?? undefined,
        },
      });

      return asset;
    } catch (err) {
      // Persistence failed — remove the orphaned object so storage stays clean.
      await deleteObject(fileKey).catch(() => undefined);
      throw err;
    }
  }

  // Register an asset that is already in storage (legacy presign→PUT flow).
  static async register(ctx: RequestContext, input: RegisterAssetInput) {
    // M-05: server-side allowlist parity with upload()/getPresignedUrl().
    if (!isAllowedMediaType(input.mimeType)) {
      throw new ValidationError([{ message: `File type "${input.mimeType}" is not supported` }]);
    }
    const asset = await MediaRepository.create(ctx.orgId, ctx.user.id, input);

    // Durable audit/activity owned by the sync register path (Inngest-independent)
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "media.uploaded",
      entityType: "media_asset",
      entityId: asset.id,
      newValue: { name: asset.name, mimeType: asset.mimeType, folderId: asset.folderId ?? undefined },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "uploaded",
      objectType: "media_asset",
      objectId: asset.id,
      objectSnapshot: { name: asset.name, mimeType: asset.mimeType },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "media/uploaded",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        assetId: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        folderId: asset.folderId ?? undefined,
      },
    });

    return asset;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateAssetInput) {
    const existing = await MediaRepository.findById(ctx.orgId, id);
    if (!existing) throw new NotFoundError("MediaAsset", id);

    const updated = await MediaRepository.update(ctx.orgId, id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "media.updated",
      entityType: "media_asset",
      entityId: id,
      oldValue: { name: existing.name, tags: existing.tags },
      newValue: { name: input.name ?? existing.name, tags: input.tags ?? existing.tags },
    });

    return updated;
  }

  static async replace(ctx: RequestContext, id: string, input: ReplaceAssetInput) {
    const existing = await MediaRepository.findById(ctx.orgId, id);
    if (!existing) throw new NotFoundError("MediaAsset", id);

    // M-05: server-side allowlist parity with upload()/getPresignedUrl().
    if (!isAllowedMediaType(input.mimeType)) {
      throw new ValidationError([{ message: `File type "${input.mimeType}" is not supported` }]);
    }

    const newAssetId = uuid();
    const newAsset = await MediaRepository.replace(ctx.orgId, id, input, newAssetId);
    if (!newAsset) throw new NotFoundError("MediaAsset", id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "media.replaced",
      entityType: "media_asset",
      entityId: id,
      oldValue: { fileKey: existing.fileKey },
      newValue: { fileKey: input.fileKey, replacedById: newAssetId },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "replaced",
      objectType: "media_asset",
      objectId: id,
      objectSnapshot: { name: existing.name, newFileKey: input.fileKey },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "media/replaced",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { assetId: newAssetId, oldFileKey: existing.fileKey, newFileKey: input.fileKey },
    });

    return newAsset;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await MediaRepository.findById(ctx.orgId, id);
    if (!existing) throw new NotFoundError("MediaAsset", id);

    const usageCount = await MediaRepository.getUsageCount(id);
    if (usageCount > 0) {
      throw new ConflictError(
        `Cannot delete asset - it is used in ${usageCount} place(s). Remove all references first.`,
      );
    }

    // Remove the underlying object BEFORE soft-deleting so storage failures
    // surface as errors and the DB record stays intact. Missing objects (404)
    // are tolerated (legacy assets never stored in Supabase).
    if (isStorageConfigured() && existing.fileKey) {
      await deleteObject(existing.fileKey);
    }

    await MediaRepository.softDelete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "media.deleted",
      entityType: "media_asset",
      entityId: id,
      oldValue: { name: existing.name, fileKey: existing.fileKey },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "deleted",
      objectType: "media_asset",
      objectId: id,
      objectSnapshot: { name: existing.name },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "media/deleted",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { assetId: id, name: existing.name },
    });
  }

  static async trackUsage(
    ctx: RequestContext,
    assetId: string,
    entityType: string,
    entityId: string,
    fieldName?: string,
  ) {
    await MediaRepository.trackUsage(ctx.orgId, assetId, entityType, entityId, fieldName);
  }

  static async untrackUsage(
    _ctx: RequestContext,
    assetId: string,
    entityType: string,
    entityId: string,
    fieldName?: string,
  ) {
    await MediaRepository.untrackUsage(assetId, entityType, entityId, fieldName);
  }
}

// ─── MediaFolderService ────────────────────────────────────────────────────────

export class MediaFolderService {
  static async list(ctx: RequestContext, parentId?: string) {
    return MediaFolderRepository.findAll(ctx.orgId, parentId);
  }

  static async getById(ctx: RequestContext, id: string) {
    const folder = await MediaFolderRepository.findById(ctx.orgId, id);
    if (!folder) throw new NotFoundError("MediaFolder", id);
    return folder;
  }

  static async create(ctx: RequestContext, input: CreateFolderInput) {
    const folder = await MediaFolderRepository.create(ctx.orgId, ctx.user.id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "media_folder.created",
      entityType: "media_folder",
      entityId: folder.id,
      newValue: { name: folder.name, path: folder.path },
    });

    return folder;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateFolderInput) {
    const existing = await MediaFolderRepository.findById(ctx.orgId, id);
    if (!existing) throw new NotFoundError("MediaFolder", id);

    const updated = await MediaFolderRepository.update(ctx.orgId, id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "media_folder.updated",
      entityType: "media_folder",
      entityId: id,
      oldValue: { name: existing.name, path: existing.path },
      newValue: { name: updated?.name, path: updated?.path },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await MediaFolderRepository.findById(ctx.orgId, id);
    if (!existing) throw new NotFoundError("MediaFolder", id);

    const hasContents = await MediaFolderRepository.hasChildren(ctx.orgId, id);
    if (hasContents) {
      throw new ConflictError("Cannot delete folder - it contains files or sub-folders. Move or delete contents first.");
    }

    await MediaFolderRepository.delete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "media_folder.deleted",
      entityType: "media_folder",
      entityId: id,
      oldValue: { name: existing.name, path: existing.path },
    });
  }
}
