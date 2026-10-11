import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_INTERAKT_DASHBOARD_URL, interaktDashboardUrl } from "./interakt-link";

const ADMIN_SRC = path.resolve(__dirname, "../..");

describe("interaktDashboardUrl", () => {
  it("defaults to the Interakt app when unset or blank", () => {
    assert.equal(interaktDashboardUrl(undefined), DEFAULT_INTERAKT_DASHBOARD_URL);
    assert.equal(interaktDashboardUrl(null), DEFAULT_INTERAKT_DASHBOARD_URL);
    assert.equal(interaktDashboardUrl("   "), DEFAULT_INTERAKT_DASHBOARD_URL);
  });

  it("accepts https interakt.ai overrides", () => {
    assert.equal(interaktDashboardUrl("https://app.interakt.ai/inbox"), "https://app.interakt.ai/inbox");
    assert.equal(interaktDashboardUrl("https://interakt.ai"), "https://interakt.ai/");
  });

  it("rejects non-https, foreign hosts, look-alikes and credentials (no open redirect)", () => {
    for (const bad of [
      "http://app.interakt.ai",
      "https://evil.com",
      "https://interakt.ai.evil.com",
      "https://evilinterakt.ai",
      "javascript:alert(1)",
      "https://user:pass@app.interakt.ai",
      "not a url",
    ]) {
      assert.equal(interaktDashboardUrl(bad), DEFAULT_INTERAKT_DASHBOARD_URL, bad);
    }
  });
});

describe("WhatsApp admin UI (regression)", () => {
  const sidebar = readFileSync(path.join(ADMIN_SRC, "components/layout/sidebar.tsx"), "utf8");

  it("sidebar has exactly one WhatsApp entry and it is the external Interakt link", () => {
    const whatsappHrefs = sidebar.match(/href:\s*["'`]\/whatsapp[^"'`]*["'`]/g) ?? [];
    assert.deepEqual(whatsappHrefs, [], "no internal /whatsapp nav items");
    assert.equal((sidebar.match(/INTERAKT_DASHBOARD_URL/g) ?? []).length >= 1, true);
    assert.equal((sidebar.match(/label:\s*"WhatsApp \(Interakt\)"/g) ?? []).length, 1);
    assert.match(sidebar, /target="_blank"/);
    assert.match(sidebar, /rel="noopener noreferrer"/);
    assert.doesNotMatch(sidebar, /WhatsApp Business/);
  });

  it("obsolete WhatsApp UI pages are gone but backend routes stay", () => {
    for (const page of ["inbox", "contacts", "campaigns", "automations", "sequences", "templates", "analytics", "settings"]) {
      assert.equal(existsSync(path.join(ADMIN_SRC, `app/(dashboard)/whatsapp/${page}/page.tsx`)), false, page);
    }
    assert.equal(existsSync(path.join(ADMIN_SRC, "app/(dashboard)/whatsapp/page.tsx")), false, "overview page");
    const legacy = readFileSync(path.join(ADMIN_SRC, "app/(dashboard)/whatsapp/[[...slug]]/route.ts"), "utf8");
    assert.match(legacy, /interaktDashboardUrl/, "legacy routes redirect to Interakt");
    for (const api of [
      "app/api/webhooks/whatsapp/route.ts",
      "app/api/v1/whatsapp/settings/route.ts",
      "app/api/v1/whatsapp/templates/route.ts",
    ]) {
      assert.equal(existsSync(path.join(ADMIN_SRC, api)), true, api);
    }
  });
});
