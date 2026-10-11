import { BookOpen, ExternalLink } from "lucide-react";
import { courseOverview } from "@/lib/lms/course-overview";

export function OverviewBadge() {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
      Overview
    </span>
  );
}

export function CourseOverviewDetails({
  title,
  description,
  metadata,
}: {
  title: string;
  description?: string | null;
  metadata?: unknown;
}) {
  const o = courseOverview(metadata);
  const rows: Array<[string, string | null]> = [
    ["Duration", o.duration],
    ["Mode", o.mode],
    ["Fee", o.fee],
  ];
  return (
    <div className="flex items-start gap-3 min-w-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
        <BookOpen className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white" data-testid="lms-overview-title">{title}</p>
          <OverviewBadge />
        </div>
        {description && <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" data-testid="lms-overview-facts">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-1">
              <dt className="text-muted-foreground">{label}:</dt>
              <dd className="text-foreground/80">{value ?? "Not specified"}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-amber-300/80" data-testid="lms-overview-note">
          Overview only — this course has no LMS curriculum (stages or modules).
        </p>
        {o.websiteUrl && (
          <a
            href={o.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="lms-overview-website"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
          >
            View course page on website <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
