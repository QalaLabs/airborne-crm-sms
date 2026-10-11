import { createElement, type ReactNode } from "react";
import type { PageBlockModel } from "@/types";
import { parseRichText, safeHref, safeMediaSrc, videoEmbedUrl, type RichNode } from "@/lib/cms/safe-content";

const ALIGN_CLASSES: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function renderRich(nodes: RichNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.t === "text") return node.v;
    const children = node.children.length ? renderRich(node.children) : undefined;
    if (node.tag === "a") {
      if (!node.href) return <span key={i}>{children}</span>;
      return (
        <a key={i} href={node.href} {...(node.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {children}
        </a>
      );
    }
    return createElement(node.tag, { key: i }, children);
  });
}

export default function BlockRenderer({ block }: { block: PageBlockModel }) {
  const { type } = block.blockType;
  const props = block.props ?? {};

  switch (type) {
    case "heading": {
      const level = Number(props.level ?? 2);
      const Tag = (["h1", "h2", "h3", "h4"] as const)[Math.min(Math.max(level, 1), 4) - 1] ?? "h2";
      const align = ALIGN_CLASSES[String(props.align ?? "left")] ?? ALIGN_CLASSES.left;
      return (
        <Tag className={`${align} font-bold tracking-tight`}>
          {String(props.content ?? "")}
        </Tag>
      );
    }

    case "text": {
      const align = ALIGN_CLASSES[String(props.align ?? "left")] ?? ALIGN_CLASSES.left;
      return (
        <p className={`${align} leading-relaxed`}>
          {String(props.content ?? "")}
        </p>
      );
    }

    case "rich_text": {
      return (
        <div className="prose prose-slate dark:prose-invert max-w-none leading-relaxed">
          {renderRich(parseRichText(props.content))}
        </div>
      );
    }

    case "image": {
      const src = safeMediaSrc(props.src);
      if (!src) return null;
      return (
        <figure>
          <img
            src={src}
            alt={String(props.alt ?? "")}
            className={`w-full ${String(props.objectFit ?? "cover") === "contain" ? "object-contain" : "object-cover"} rounded-lg`}
          />
          {props.caption ? (
            <figcaption className="mt-2 text-sm text-muted-foreground">
              {String(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    }

    case "video": {
      const embed = videoEmbedUrl(props.src);
      const file = embed ? null : safeMediaSrc(props.src);
      if (!embed && !file) return null;
      const ratio = String(props.aspectRatio ?? "16/9");
      const [w, h] = ratio.split("/").map(Number);
      const pad = w && h ? `${(h / w) * 100}%` : "56.25%";
      return (
        <div className="my-4">
          <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ paddingBottom: pad }}>
            {embed ? (
              <iframe
                src={embed}
                title={String(props.title ?? "Embedded video")}
                className="absolute inset-0 h-full w-full"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video src={file ?? undefined} controls className="absolute inset-0 h-full w-full" />
            )}
          </div>
          {props.title ? (
            <p className="mt-2 text-sm text-muted-foreground">{String(props.title)}</p>
          ) : null}
        </div>
      );
    }

    case "button": {
      const label = String(props.label ?? "");
      const href = safeHref(props.href);
      if (!label || !href) return null;
      const variant = String(props.variant ?? "primary");
      const classes: Record<string, string> = {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      };
      const newTab = props.target === "_blank";
      return (
        <a
          href={href}
          {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${classes[variant] ?? classes.primary}`}
        >
          {label}
        </a>
      );
    }

    case "spacer": {
      const height = Number(props.height ?? 48);
      return <div style={{ height: Number.isFinite(height) && height >= 0 ? height : 48 }} />;
    }

    default:
      return null;
  }
}
