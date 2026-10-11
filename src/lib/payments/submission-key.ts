/**
 * Stable idempotency key per logical payment submission.
 *
 * The same form contents keep the same key across double clicks, re-renders
 * and retries after a failed/timed-out request, so the server replays the
 * original receipt instead of recording a second payment. The key rotates only
 * when the payment details change or after the server confirms success.
 */
export interface PaymentFingerprintInput {
  admissionId: string;
  amount: number | string;
  method: string;
  feeType: string;
  referenceNo?: string | null;
}

export function paymentFingerprint(input: PaymentFingerprintInput): string {
  const amount = Number(input.amount);
  return JSON.stringify([
    input.admissionId,
    Number.isFinite(amount) ? amount.toFixed(2) : String(input.amount),
    input.method,
    input.feeType,
    (input.referenceNo ?? "").trim(),
  ]);
}

export interface SubmissionKeyManager {
  keyFor(input: PaymentFingerprintInput): string;
  complete(key: string): void;
}

export function createSubmissionKeyManager(generate: () => string): SubmissionKeyManager {
  let current: { fingerprint: string; key: string } | null = null;
  return {
    keyFor(input) {
      const fingerprint = paymentFingerprint(input);
      if (current?.fingerprint !== fingerprint) current = { fingerprint, key: generate() };
      return current.key;
    },
    complete(key) {
      if (current?.key === key) current = null;
    },
  };
}
