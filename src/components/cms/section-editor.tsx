"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import BlockEditor from "@/components/cms/block-editor";
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Eye,
  EyeOff,
  Plus,
  LayoutGrid,
} from "lucide-react";
import type { BlockTypeModel, PageSectionModel } from "@/types";

export default function SectionEditor({
  section,
  blockTypes,
  canMoveUp,
  canMoveDown,
  onRename,
  onVisibilityToggle,
  onMoveUp,
  onMoveDown,
  onDelete,
  onAddBlock,
  onBlockPropsChange,
  onBlockVisibilityToggle,
  onBlockMoveUp,
  onBlockMoveDown,
  onBlockDelete,
}: {
  section: PageSectionModel;
  blockTypes: BlockTypeModel[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (name: string) => void;
  onVisibilityToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onAddBlock: (blockType: BlockTypeModel) => void;
  onBlockPropsChange: (blockId: string, props: Record<string, unknown>) => void;
  onBlockVisibilityToggle: (blockId: string) => void;
  onBlockMoveUp: (blockId: string) => void;
  onBlockMoveDown: (blockId: string) => void;
  onBlockDelete: (blockId: string) => void;
}) {
  const sortedBlocks = [...section.blocks].sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-2xl border border-white/10 bg-secondary/20">
      <div className="flex items-center gap-2 border-b border-white/10 p-3">
        <LayoutGrid className="h-4 w-4 shrink-0 text-primary" />
        <Input
          value={section.name ?? ""}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Section name"
          className="h-8 flex-1 border-white/10 bg-slate-950/40 text-xs font-bold text-white"
        />

        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 border border-white/10" aria-label="Move section up" disabled={!canMoveUp} onClick={onMoveUp}>
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 border border-white/10" aria-label="Move section down" disabled={!canMoveDown} onClick={onMoveDown}>
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 border border-white/10" aria-label={section.isVisible ? "Hide section" : "Show section"} onClick={onVisibilityToggle}>
          {section.isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 border border-rose-500/20 text-rose-400 hover:bg-rose-500/10" aria-label="Delete section" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2 p-3">
        {sortedBlocks.map((block, index) => (
          <BlockEditor
            key={block.id}
            block={block}
            canMoveUp={index > 0}
            canMoveDown={index < sortedBlocks.length - 1}
            onPropsChange={(props) => onBlockPropsChange(block.id, props)}
            onVisibilityToggle={() => onBlockVisibilityToggle(block.id)}
            onMoveUp={() => onBlockMoveUp(block.id)}
            onMoveDown={() => onBlockMoveDown(block.id)}
            onDelete={() => onBlockDelete(block.id)}
          />
        ))}

        {sortedBlocks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 py-6 text-center text-xs text-muted-foreground">
            No blocks in this section yet.
          </p>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full border-white/10 text-xs font-bold">
              <Plus className="h-3.5 w-3.5" /> Add Block
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-64">
            <DropdownMenuLabel className="text-xs font-bold text-muted-foreground">
              Block Types
            </DropdownMenuLabel>
            {blockTypes.map((bt) => (
              <DropdownMenuItem key={bt.id} className="cursor-pointer" onSelect={() => onAddBlock(bt)}>
                <span className="text-xs font-bold text-white">{bt.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{bt.type}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
