import test from "node:test";
import assert from "node:assert/strict";

function formatTargetPhone(raw: string): string {
  let target = raw.replace(/[\s-]/g, "");
  if (!target.startsWith("+")) {
    const digitsOnly = target.replace(/\D/g, "");
    if (digitsOnly.length === 10) {
      target = `+91${digitsOnly}`;
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
      target = `+${digitsOnly}`;
    } else {
      target = `+${digitsOnly}`;
    }
  }
  return target;
}

function extractRecordingUrl(metadata: Record<string, any> | null | undefined): string | null {
  if (!metadata) return null;
  return (
    metadata.recording_url ||
    metadata.recordingUrl ||
    metadata.record_url ||
    metadata.file_url ||
    metadata.gcs_recording_url ||
    null
  );
}

test("agent call phone normalization formats Indian 10-digit mobile to +91", () => {
  assert.equal(formatTargetPhone("9876543210"), "+919876543210");
  assert.equal(formatTargetPhone("919876543210"), "+919876543210");
  assert.equal(formatTargetPhone("+91 98765 43210"), "+919876543210");
  assert.equal(formatTargetPhone("+1 415 555 2671"), "+14155552671");
});

test("recording URL extraction supports TeleCMI and Cloud Storage metadata keys", () => {
  assert.equal(
    extractRecordingUrl({ recording_url: "https://storage.googleapis.com/airborne-aviation-media-prod/call-1.wav" }),
    "https://storage.googleapis.com/airborne-aviation-media-prod/call-1.wav"
  );
  assert.equal(
    extractRecordingUrl({ recordingUrl: "https://telecmi.com/rec/2.mp3" }),
    "https://telecmi.com/rec/2.mp3"
  );
  assert.equal(
    extractRecordingUrl({ gcs_recording_url: "https://storage.googleapis.com/calls/rec3.mp3" }),
    "https://storage.googleapis.com/calls/rec3.mp3"
  );
  assert.equal(
    extractRecordingUrl({ record_url: "https://piopiy.io/records/4.wav" }),
    "https://piopiy.io/records/4.wav"
  );
  assert.equal(extractRecordingUrl({}), null);
  assert.equal(extractRecordingUrl(null), null);
});
