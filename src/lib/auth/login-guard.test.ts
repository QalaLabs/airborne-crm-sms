import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_IP_LIMIT,
  guardCredentialsLogin,
} from "./login-guard";

function credentialsRequest(ip = "198.51.100.7", email = "user@example.com") {
  return new NextRequest("http://localhost/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ip,
    },
    body: `csrfToken=t&email=${encodeURIComponent(email)}&password=12345678&orgSlug=airborne-aviation&json=true`,
  });
}

test("non-credentials paths pass through untouched", async () => {
  const req = new NextRequest("http://localhost/api/auth/session", { method: "GET" });
  const out = await guardCredentialsLogin(req);
  assert.ok(!out.response, "no blocking response expected");
  assert.equal(out.request, req, "original request object should be forwarded");
});

test("credentials sign-in is rate limited per IP", async () => {
  for (let i = 0; i < LOGIN_IP_LIMIT; i++) {
    const out = await guardCredentialsLogin(credentialsRequest("198.51.100.7", `user${i}@example.com`));
    assert.ok(!out.response, `attempt ${i + 1}/${LOGIN_IP_LIMIT} should pass`);
  }
  const blocked = await guardCredentialsLogin(credentialsRequest("198.51.100.7", "fresh@example.com"));
  assert.ok(!blocked.request, "limit exceeded: request should be denied");
  assert.ok(blocked.response, "limit exceeded: 429 response expected");
  assert.equal(blocked.response.status, 429);
});

test("credentials sign-in is rate limited per account", async () => {
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) {
    const out = await guardCredentialsLogin(credentialsRequest(`198.51.100.8.${i}`, "victim@example.com"));
    assert.ok(!out.response, `account attempt ${i + 1}/${LOGIN_ACCOUNT_LIMIT} should pass`);
  }
  const blocked = await guardCredentialsLogin(credentialsRequest("198.51.100.8.99", "victim@example.com"));
  assert.ok(!blocked.request);
  assert.equal(blocked.response.status, 429);
});

test("reconstructed request preserves the exact credentials body", async () => {
  const out = await guardCredentialsLogin(credentialsRequest("203.0.113.10", "replay@example.com"));
  assert.ok(!out.response && out.request);
  const text = await out.request.text();
  assert.ok(text.includes("email=replay%40example.com"), "email must be replayed for Auth.js");
  assert.ok(text.includes("csrfToken=t"));
  assert.equal(out.request.method, "POST");
});