// Overview-only LMS courses mirror a public website course (metadata.overviewOnly)
// and carry no curriculum; the admin UI shows their summary instead of the builder.

export const PUBLIC_SITE_URL = "https://www.airborneaviation.in";

export interface CourseOverview {
  duration: string | null;
  mode: string | null;
  fee: string | null;
  websiteUrl: string | null;
}

function record(metadata: unknown): Record<string, unknown> | null {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function isOverviewOnly(course: { metadata?: unknown }): boolean {
  return record(course.metadata)?.overviewOnly === true;
}

export function courseOverview(metadata: unknown): CourseOverview {
  const m = record(metadata) ?? {};
  const path = text(m.websitePath);
  return {
    duration: text(m.duration),
    mode: text(m.mode),
    fee: text(m.fee),
    websiteUrl: path && path.startsWith("/") && !path.startsWith("//") ? `${PUBLIC_SITE_URL}${path}` : null,
  };
}
