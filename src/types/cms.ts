// ─── CMS Page Builder — Client Types ────────────────────────────────────────

export type PageStatus = "DRAFT" | "PUBLISHED" | "SCHEDULED" | "ARCHIVED";

export interface BlockPropDef {
  type?: string;
  title?: string;
  description?: string;
  enum?: Array<string | number>;
  default?: unknown;
  ui?: string;
}

export interface BlockSchema {
  type?: string;
  properties?: Record<string, BlockPropDef>;
  required?: string[];
}

export interface BlockTypeModel {
  id: string;
  type: string;
  name: string;
  schema: BlockSchema;
  defaultProps: Record<string, unknown>;
}

export interface PageBlockModel {
  id: string;
  sectionId: string;
  blockTypeId: string;
  order: number;
  props: Record<string, unknown>;
  isVisible: boolean;
  blockType: BlockTypeModel;
}

export interface PageSectionModel {
  id: string;
  name: string | null;
  order: number;
  isVisible: boolean;
  settings: Record<string, unknown>;
  blocks: PageBlockModel[];
}

export interface PageModel {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: PageStatus;
  publishedAt: string | null;
  scheduledAt: string | null;
  seoTitle: string | null;
  seoDesc: string | null;
  seoKeywords: string[];
  ogImage: string | null;
  metadata: Record<string, unknown>;
  version: number;
  createdBy: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; name: string } | null;
  publisher?: { id: string; name: string } | null;
  sections: PageSectionModel[];
}

export interface PageVersionModel {
  id: string;
  orgId: string;
  pageId: string;
  version: number;
  title: string;
  status: PageStatus;
  publishedAt: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  creator?: { id: string; name: string } | null;
}

export interface PageMetaPatch {
  title?: string;
  slug?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDesc?: string | null;
  seoKeywords?: string[];
  ogImage?: string | null;
}
