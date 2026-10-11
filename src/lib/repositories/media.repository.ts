import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type {
  RegisterAssetInput,
  UpdateAssetInput,
  ReplaceAssetInput,
  AssetFilters,
  CreateFolderInput,
  UpdateFolderInput,
} from "@/lib/validations/media.schema";

// ─── Selects ─────────────────────────────────────────────────────────────────

const ASSET_SELECT = {
  id: true,
  orgId: true,
  folderId: true,
  uploadedBy: true,
  name: true,
  originalName: true,
  fileKey: true,
  fileUrl: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  duration: true,
  altText: true,
  caption: true,
  tags: true,
  usageCount: true,
  replacedById: true,
  isActive: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  folder: { select: { id: true, name: true, path: true } },
  uploader: { select: { id: true, name: true } },
} satisfies Prisma.MediaAssetSelect;

const FOLDER_SELECT = {
  id: true,
  orgId: true,
  parentId: true,
  name: true,
  slug: true,
  path: true,
  createdAt: true,
  updatedAt: true,
  parent: { select: { id: true, name: true } },
} satisfies Prisma.MediaFolderSelect;

// ─── Asset Repository ─────────────────────────────────────────────────────────

export class MediaRepository {
  static async findMany(orgId: string, filters: AssetFilters) {
    const tagList = filters.tags
      ? filters.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : undefined;

    const where: Prisma.MediaAssetWhereInput = {
      orgId,
      isActive: filters.isActive ?? true,
      ...(filters.folderId !== undefined && { folderId: filters.folderId }),
      ...(filters.mimeType && { mimeType: { startsWith: filters.mimeType } }),
      ...(tagList?.length && { tags: { hasSome: tagList } }),
      ...(filters.search && {
        name: { contains: filters.search, mode: "insensitive" as const },
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        select: ASSET_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.mediaAsset.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.mediaAsset.findFirst({
      where: { id, orgId },
      select: {
        ...ASSET_SELECT,
        usages: {
          select: { id: true, entityType: true, entityId: true, fieldName: true },
        },
      },
    });
  }

  static async create(
    orgId: string,
    uploadedBy: string,
    data: RegisterAssetInput,
  ) {
    return prisma.mediaAsset.create({
      data: {
        orgId,
        uploadedBy,
        name: data.name,
        originalName: data.originalName,
        fileKey: data.fileKey,
        fileUrl: data.fileUrl,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        width: data.width,
        height: data.height,
        duration: data.duration,
        altText: data.altText,
        caption: data.caption,
        tags: data.tags ?? [],
        folderId: data.folderId,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: ASSET_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateAssetInput) {
    return prisma.mediaAsset.update({
      where: { id, orgId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.altText !== undefined && { altText: data.altText }),
        ...(data.caption !== undefined && { caption: data.caption }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.folderId !== undefined && { folderId: data.folderId }),
      },
      select: ASSET_SELECT,
    });
  }

  static async replace(orgId: string, id: string, data: ReplaceAssetInput, newAssetId: string) {
    // Create new asset record that replaces this one
    const original = await prisma.mediaAsset.findFirst({
      where: { id, orgId },
      select: { name: true, originalName: true, altText: true, caption: true, tags: true, folderId: true, metadata: true, uploadedBy: true },
    });
    if (!original) return null;

    const [newAsset] = await prisma.$transaction([
      prisma.mediaAsset.create({
        data: {
          id: newAssetId,
          orgId,
          uploadedBy: original.uploadedBy,
          name: original.name,
          originalName: data.fileKey.split("/").pop() ?? original.originalName,
          fileKey: data.fileKey,
          fileUrl: data.fileUrl,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          width: data.width,
          height: data.height,
          duration: data.duration,
          altText: original.altText,
          caption: original.caption,
          tags: original.tags,
          folderId: original.folderId,
          metadata: original.metadata as Prisma.InputJsonValue,
        },
        select: ASSET_SELECT,
      }),
      prisma.mediaAsset.update({
        where: { id, orgId },
        data: { replacedById: newAssetId, isActive: false },
        select: { id: true },
      }),
    ]);

    return newAsset;
  }

  static async softDelete(orgId: string, id: string) {
    return prisma.mediaAsset.update({
      where: { id, orgId },
      data: { isActive: false },
      select: { id: true },
    });
  }

  static async getUsageCount(id: string) {
    return prisma.mediaUsage.count({ where: { assetId: id } });
  }

  // B-03: Only increment usageCount when a new MediaUsage row is actually created
  static async trackUsage(
    orgId: string,
    assetId: string,
    entityType: string,
    entityId: string,
    fieldName?: string,
  ) {
    const key = fieldName ?? "";
    const existing = await prisma.mediaUsage.findUnique({
      where: { assetId_entityType_entityId_fieldName: { assetId, entityType, entityId, fieldName: key } },
      select: { id: true },
    });
    if (!existing) {
      await prisma.$transaction([
        prisma.mediaUsage.create({ data: { orgId, assetId, entityType, entityId, fieldName: key } }),
        prisma.mediaAsset.update({
          where: { id: assetId },
          data: { usageCount: { increment: 1 } },
          select: { id: true },
        }),
      ]);
    }
  }

  // B-07: usageCount floored at 0 — two conditional updates to prevent negative counts
  static async untrackUsage(
    assetId: string,
    entityType: string,
    entityId: string,
    fieldName?: string,
  ) {
    const deleted = await prisma.mediaUsage.deleteMany({
      where: { assetId, entityType, entityId, fieldName: fieldName ?? "" },
    });
    if (deleted.count > 0) {
      // Decrement only when count won't go below 0; otherwise reset to 0
      await prisma.mediaAsset.updateMany({
        where: { id: assetId, usageCount: { gte: deleted.count } },
        data: { usageCount: { decrement: deleted.count } },
      });
      await prisma.mediaAsset.updateMany({
        where: { id: assetId, usageCount: { lt: deleted.count } },
        data: { usageCount: 0 },
      });
    }
  }
}

// ─── Folder Repository ────────────────────────────────────────────────────────

export class MediaFolderRepository {
  static async findAll(orgId: string, parentId?: string) {
    return prisma.mediaFolder.findMany({
      where: {
        orgId,
        ...(parentId === undefined ? {} : { parentId }),
      },
      select: FOLDER_SELECT,
      orderBy: { path: "asc" },
    });
  }

  static async findById(orgId: string, id: string) {
    return prisma.mediaFolder.findFirst({
      where: { id, orgId },
      select: {
        ...FOLDER_SELECT,
        children: { select: FOLDER_SELECT },
        assets: { where: { isActive: true }, select: { id: true }, take: 1 },
      },
    });
  }

  static async create(orgId: string, createdBy: string, data: CreateFolderInput) {
    let path = `/${slugify(data.name)}`;

    if (data.parentId) {
      const parent = await prisma.mediaFolder.findFirst({
        where: { id: data.parentId, orgId },
        select: { path: true },
      });
      if (parent) path = `${parent.path}/${slugify(data.name)}`;
    }

    // Ensure unique path in org
    const existing = await prisma.mediaFolder.count({ where: { orgId, path } });
    if (existing > 0) path = `${path}-${Date.now()}`;

    return prisma.mediaFolder.create({
      data: {
        orgId,
        parentId: data.parentId,
        name: data.name,
        slug: slugify(data.name),
        path,
        createdBy,
      },
      select: FOLDER_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateFolderInput) {
    const folder = await prisma.mediaFolder.findFirst({ where: { id, orgId }, select: { path: true, name: true } });
    if (!folder) return null;

    const newName = data.name ?? folder.name;
    let newPath = folder.path;

    if (data.name || data.parentId !== undefined) {
      let basePath = "";
      if (data.parentId) {
        const parent = await prisma.mediaFolder.findFirst({
          where: { id: data.parentId, orgId },
          select: { path: true },
        });
        basePath = parent?.path ?? "";
      }
      newPath = `${basePath}/${slugify(newName)}`;
    }

    return prisma.mediaFolder.update({
      where: { id, orgId },
      data: {
        ...(data.name && { name: data.name, slug: slugify(data.name) }),
        ...(data.parentId !== undefined && { parentId: data.parentId }),
        path: newPath,
      },
      select: FOLDER_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.mediaFolder.delete({ where: { id, orgId } });
  }

  static async hasChildren(orgId: string, id: string) {
    const [childFolders, childAssets] = await Promise.all([
      prisma.mediaFolder.count({ where: { parentId: id, orgId } }),
      prisma.mediaAsset.count({ where: { folderId: id, orgId, isActive: true } }),
    ]);
    return childFolders + childAssets > 0;
  }
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
