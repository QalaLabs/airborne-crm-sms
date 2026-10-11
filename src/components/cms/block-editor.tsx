"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, Trash2, Eye, EyeOff, Pencil } from "lucide-react";
import BlockForm from "@/components/cms/block-form";
import type { PageBlockModel } from "@/types";

export default function BlockEditor({
  block,
  canMoveUp,
  canMoveDown,
  onPropsChange,
  onVisibilityToggle,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  block: PageBlockModel;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPropsChange: (props: Record<string, unknown>) => void;
  onVisibilityToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/50">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 items-center gap-2 rounded-md text-left hover:bg-white/5 px-1.5 py-1"
        >
          <Pencil className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate text-xs font-bold text-white">
            {block.blockType.name}
          </span>
          <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold text-primary">
            {block.blockType.type}
          </span>
        </button>

        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 border border-white/10" aria-label="Move block up" disabled={!canMoveUp} onClick={onMoveUp}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 border border-white/10" aria-label="Move block down" disabled={!canMoveDown} onClick={onMoveDown}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 border border-white/10" aria-label={block.isVisible ? "Hide block" : "Show block"} onClick={onVisibilityToggle}>
            {block.isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 border border-rose-500/20 text-rose-400 hover:bg-rose-500/10" aria-label="Delete block" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-white/10 px-3 py-3">
          <BlockForm
            schema={block.blockType.schema}
            value={block.props}
            onChange={onPropsChange}
          />
        </div>
      ) : (
        <div className="border-t border-white/10 px-3 py-1.5">
          <p className="truncate text-[10px] text-muted-foreground">
            {Object.entries(block.props ?? {})
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
              .join(" · ") || "No props set"}
          </p>
        </div>
      )}
    </div>
  );
}
