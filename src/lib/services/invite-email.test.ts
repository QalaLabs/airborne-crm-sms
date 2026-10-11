import test from "node:test";
import assert from "node:assert/strict";
import { inviteLink, sendInviteEmail } from "./invite-email";

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

test("inviteLink prefers AUTH_URL and falls back to the request origin", async () => {
  await withEnv({ AUTH_URL: "https://admin.example.test/", NEXT_PUBLIC_APP_URL: undefined }, () => {
    assert.equal(inviteLink("tok", "http://localhost:4000"), "https://admin.example.test/invite/tok");
  });
  await withEnv({ AUTH_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }, () => {
    assert.equal(inviteLink("tok", "http://localhost:4000"), "http://localhost:4000/invite/tok");
  });
});

test("sendInviteEmail reports NOT_CONFIGURED instead of claiming a send when no provider is set up", async () => {
  await withEnv({ EMAIL_PROVIDER: "unregistered-provider" }, async () => {
    const out = await sendInviteEmail({ to: "a@example.test", name: "A", role: "SUPPORT_STAFF", link: "https://x/invite/t" });
    assert.equal(out.status, "NOT_CONFIGURED");
  });
});
