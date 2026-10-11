"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlockSchema } from "@/types";

export default function BlockForm({
  schema,
  value,
  onChange,
}: {
  schema: BlockSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This block has no editable properties.
      </p>
    );
  }

  const setField = (key: string, next: unknown) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const def = properties[key];
        if (!def) return null;
        const current = value[key];
        const isRequired = required.includes(key);
        const label = def.title ?? key;

        if (def.enum && def.enum.length > 0) {
          return (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`block-prop-${key}`} className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
                {label}
                {isRequired ? <span className="text-destructive">*</span> : null}
              </label>
              <Select
                value={String(current ?? def.enum[0])}
                onValueChange={(v) => {
                  const original = def.enum?.find((e) => String(e) === v);
                  setField(key, typeof original === "number" ? Number(v) : v);
                }}
              >
                <SelectTrigger id={`block-prop-${key}`} className="w-full bg-secondary/40 border-white/10 text-xs font-semibold text-white">
                  <SelectValue placeholder={label} />
                </SelectTrigger>
                <SelectContent>
                  {def.enum.map((option) => (
                    <SelectItem key={String(option)} value={String(option)}>
                      {String(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (def.ui === "richtext") {
          return (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`block-prop-${key}`} className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
                {label}
                {isRequired ? <span className="text-destructive">*</span> : null}
              </label>
              <Textarea
                id={`block-prop-${key}`}
                rows={6}
                value={String(current ?? "")}
                onChange={(e) => setField(key, e.target.value)}
                placeholder="HTML content"
                className="bg-secondary/40 border-white/10 text-xs font-medium text-white font-mono"
              />
            </div>
          );
        }

        if (def.ui === "textarea") {
          return (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`block-prop-${key}`} className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
                {label}
                {isRequired ? <span className="text-destructive">*</span> : null}
              </label>
              <Textarea
                id={`block-prop-${key}`}
                rows={3}
                value={String(current ?? "")}
                onChange={(e) => setField(key, e.target.value)}
                className="bg-secondary/40 border-white/10 text-xs font-medium text-white"
              />
            </div>
          );
        }

        if (def.type === "boolean" || def.ui === "boolean") {
          return (
            <div key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-secondary/40 px-3 py-2">
              <label htmlFor={`block-prop-${key}`} className="text-xs font-bold text-muted-foreground">
                {label}
              </label>
              <Switch
                id={`block-prop-${key}`}
                checked={Boolean(current)}
                onCheckedChange={(checked) => setField(key, checked)}
              />
            </div>
          );
        }

        return (
          <div key={key} className="space-y-1.5">
            <label htmlFor={`block-prop-${key}`} className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
              {label}
              {isRequired ? <span className="text-destructive">*</span> : null}
            </label>
            <Input
              id={`block-prop-${key}`}
              type={def.ui === "number" ? "number" : def.ui === "url" ? "url" : "text"}
              value={String(current ?? "")}
              onChange={(e) =>
                setField(key, def.ui === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)
              }
              className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
            />
          </div>
        );
      })}
    </div>
  );
}
