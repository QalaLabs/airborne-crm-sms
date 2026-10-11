// Compact callback_data for Interakt Template Send (max 512 chars).
// Returned on delivery webhooks under data.message.meta_data.source_data.callback_data.

export interface CorrelationPayload {
  v: 1;
  /** Lead id */
  l?: string;
  /** Conversation id */
  c?: string;
  /** Internal WhatsAppMessage id */
  m?: string;
  /** Workflow run id */
  w?: string;
  /** Workflow step key / index */
  s?: string;
  /** Internal campaign id */
  k?: string;
  /** Idempotency key */
  i?: string;
}

const MAX_CALLBACK_DATA = 512;

export function encodeCorrelation(input: CorrelationPayload): string {
  const packed: CorrelationPayload = { v: 1 };
  if (input.l) packed.l = input.l;
  if (input.c) packed.c = input.c;
  if (input.m) packed.m = input.m;
  if (input.w) packed.w = input.w;
  if (input.s) packed.s = input.s;
  if (input.k) packed.k = input.k;
  if (input.i) packed.i = input.i;
  const json = JSON.stringify(packed);
  if (json.length > MAX_CALLBACK_DATA) {
    throw new Error(`callback_data exceeds Interakt 512-char limit (${json.length})`);
  }
  return json;
}

export function decodeCorrelation(raw: unknown): CorrelationPayload | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== 1) return null;
    const out: CorrelationPayload = { v: 1 };
    if (typeof rec.l === "string") out.l = rec.l;
    if (typeof rec.c === "string") out.c = rec.c;
    if (typeof rec.m === "string") out.m = rec.m;
    if (typeof rec.w === "string") out.w = rec.w;
    if (typeof rec.s === "string") out.s = rec.s;
    if (typeof rec.k === "string") out.k = rec.k;
    if (typeof rec.i === "string") out.i = rec.i;
    return out;
  } catch {
    return null;
  }
}
