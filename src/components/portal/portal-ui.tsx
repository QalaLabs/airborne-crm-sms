"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function PortalPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        {eyebrow && <p className="ab-eyebrow">{eyebrow}</p>}
        <h1 className="ab-display text-3xl text-white sm:text-4xl">{title}</h1>
        {description && (
          <p className="max-w-xl text-sm leading-relaxed text-white/50">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function GlassCard({
  className,
  hero,
  soft,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hero?: boolean; soft?: boolean }) {
  return (
    <div
      className={cn(
        hero ? "ab-glass-hero" : soft ? "ab-glass-soft" : "ab-glass",
        "p-5 sm:p-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionLabel({
  children,
  icon: Icon,
  href,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
}) {
  const inner = (
    <div className="mb-3 flex items-center gap-2">
      {Icon && <Icon className="h-4 w-4 text-[var(--ab-red)]" aria-hidden="true" />}
      <h2 className="text-sm font-semibold tracking-wide text-white/90">{children}</h2>
    </div>
  );
  if (href) {
    return (
      <a href={href} className="group mb-3 flex items-center justify-between gap-2">
        {inner}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35 group-hover:text-[var(--ab-red)]">
          View all
        </span>
      </a>
    );
  }
  return inner;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ab-empty" role="status">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ab-red)]/15 text-[var(--ab-red)]">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-white/80">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/40">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function MotionSection({
  children,
  className,
  delay = 0,
  ...props
}: HTMLMotionProps<"section"> & { delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      className={className}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay }}
      {...props}
    >
      {children}
    </motion.section>
  );
}

export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: { staggerChildren: reduce ? 0 : 0.06 },
        },
      }}
    >
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? (
          <motion.div
            variants={{
              hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 12 },
              show: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
              },
            }}
          >
            {child}
          </motion.div>
        ) : (
          child
        ),
      )}
    </motion.div>
  );
}

export function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "ab-glass-soft p-4 transition-colors hover:border-white/20",
        accent && "border-[rgba(200,16,46,0.35)] bg-[rgba(200,16,46,0.08)]",
      )}
    >
      <Icon
        className={cn("h-4 w-4", accent ? "text-[var(--ab-gold)]" : "text-[var(--ab-red)]")}
        aria-hidden="true"
      />
      <p className="mt-3 ab-display text-2xl text-white sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-xs text-white/50">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-white/30">{sub}</p>}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn("ab-progress-track", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="ab-progress-fill transition-all duration-700" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "success" | "warning" | "danger" | "neutral" | "brand";
}) {
  const tones = {
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    warning: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    danger: "bg-red-500/15 text-red-300 border-red-500/25",
    brand: "bg-[rgba(200,16,46,0.15)] text-[#ff6b82] border-[rgba(200,16,46,0.3)]",
    neutral: "bg-white/5 text-white/60 border-white/10",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tones[tone])}>
      {children}
    </span>
  );
}
