import type { NotificationEvent } from "@prisma/client";

// ─── Workflow step configuration (stored as Workflow.steps JSON) ─────────────
//
// Provider-independent action vocabulary. SEND_WHATSAPP/SEND_EMAIL never name a
// provider — the comms layer (Phase 2) resolves the configured provider.

export interface WaitSpec {
  days?: number;
  hours?: number;
  minutes?: number;
}

export type ConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "in"
  | "notIn"
  | "exists"
  | "notExists";

export type ConditionSpec =
  | { all: ConditionSpec[] }
  | { any: ConditionSpec[] }
  | { not: ConditionSpec }
  | { field: string; op: ConditionOp; value?: unknown };

interface StepBase {
  /** Optional human label shown in the admin UI. */
  name?: string;
}

export type WorkflowStep =
  | (StepBase & {
      type: "SEND_WHATSAPP";
      /** NotificationTemplate name override; falls back to WORKFLOW_TRIGGERED template. */
      templateName?: string;
      variables?: Record<string, string>;
    })
  | (StepBase & {
      type: "SEND_EMAIL";
      event: NotificationEvent;
      variables?: Record<string, string>;
    })
  | (StepBase & {
      type: "CREATE_TASK";
      title: string;
      notes?: string;
      dueInDays?: number;
      dueInHours?: number;
    })
  | (StepBase & { type: "ASSIGN_LEAD"; counselorId?: string })
  | (StepBase & {
      type: "UPDATE_LEAD";
      fields: {
        courseInterest?: string;
        city?: string;
        state?: string;
        nextFollowUpInDays?: number;
        customFields?: Record<string, unknown>;
      };
    })
  | (StepBase & { type: "UPDATE_STATUS"; status: string })
  | (StepBase & { type: "ADD_TAG"; tag: string })
  | (StepBase & { type: "REMOVE_TAG"; tag: string })
  | (StepBase & { type: "WAIT"; duration: WaitSpec })
  | (StepBase & {
      type: "CONDITION";
      condition: ConditionSpec;
      then: WorkflowStep[];
      else?: WorkflowStep[];
    })
  | (StepBase & {
      type: "STOP_WORKFLOW";
      reason?: string;
      /** Also stop every other active run for the same entity. */
      stopAllForEntity?: boolean;
    })
  | (StepBase & { type: "START_WORKFLOW"; workflowCode: string });

// ─── Execution context ───────────────────────────────────────────────────────

export interface ActionContext {
  orgId: string;
  runId: string;
  workflowId: string;
  entityType: string;
  entityId: string;
  /** validUuid()-filtered actor — undefined for system-triggered runs. */
  actorId?: string;
  requestId?: string;
  /** Stable key for side-effect dedup downstream: `${runId}:${stepIndex}`. */
  idempotencyKey: string;
  /** Normalized event payload that started this run (empty for manual runs). */
  event: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  /** True when the step was a no-op for this entity (e.g. no phone on file). */
  skipped?: boolean;
  detail?: string;
}

// Run statuses (WorkflowRun.status — String column, fixed vocabulary).
export const RUN_STATUS = {
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  STOPPED: "STOPPED",
} as const;

/** Statuses that mean "do not continue executing". */
export const RUN_TERMINAL_STATUSES: string[] = [
  RUN_STATUS.COMPLETED,
  RUN_STATUS.FAILED,
  RUN_STATUS.CANCELLED,
  RUN_STATUS.STOPPED,
];

/** Chunked wait size — long sleeps are split so pause/cancel is honored. */
export const WAIT_CHUNK_MS = 60 * 60 * 1000;
