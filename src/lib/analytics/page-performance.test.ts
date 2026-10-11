import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregatePagePerformance,
  normalizeLandingPath,
  normalizeReferrer,
  NOT_CAPTURED,
  DIRECT,
} from "./page-performance";

test("normalizeLandingPath strips origin, query, hash, case and trailing slashes", () => {
  assert.equal(normalizeLandingPath("https://airborne.example/Courses/CPL/?utm_source=x#top"), "/courses/cpl");
  assert.equal(normalizeLandingPath("/courses/cpl/"), "/courses/cpl");
  assert.equal(normalizeLandingPath("courses//cpl"), "/courses/cpl");
  assert.equal(normalizeLandingPath("https://airborne.example"), "/");
  assert.equal(normalizeLandingPath("/"), "/");
  assert.equal(normalizeLandingPath(""), NOT_CAPTURED);
  assert.equal(normalizeLandingPath(null), NOT_CAPTURED);
  assert.equal(normalizeLandingPath("   "), NOT_CAPTURED);
});

test("normalizeReferrer reduces to the host and treats blanks/garbage as direct", () => {
  assert.equal(normalizeReferrer("https://www.Google.com/search?q=cpl"), "google.com");
  assert.equal(normalizeReferrer("https://l.instagram.com/"), "l.instagram.com");
  assert.equal(normalizeReferrer(""), DIRECT);
  assert.equal(normalizeReferrer(null), DIRECT);
  assert.equal(normalizeReferrer("not a url"), DIRECT);
});

test("aggregatePagePerformance counts every lead once per breakdown", () => {
  const report = aggregatePagePerformance([
    { landingPage: "/courses/cpl", referrerUrl: "https://google.com", utmSource: "Google", utmCampaign: "Sept", converted: true },
    { landingPage: "https://x.example/courses/cpl/", referrerUrl: null, utmSource: "google", utmCampaign: null, converted: false },
    { landingPage: null, referrerUrl: null, utmSource: null, utmCampaign: null, converted: false },
    { landingPage: "/cabin-crew", referrerUrl: "https://facebook.com/ad", utmSource: "facebook", utmCampaign: "sept", converted: true },
  ]);

  assert.deepEqual(report.totals, { leads: 4, withLandingPage: 3, withoutLandingPage: 1, admissions: 2, conversionRate: "50.0" });
  assert.deepEqual(report.pages[0], { page: "/courses/cpl", leads: 2, admissions: 1, conversionRate: "50.0" });
  assert.equal(report.pages.reduce((n, p) => n + p.leads, 0), 4);
  assert.equal(report.referrers.reduce((n, r) => n + r.leads, 0), 4);
  assert.equal(report.utmSources.find((r) => r.key === "google")?.leads, 2, "UTM values are case-normalised");
  assert.equal(report.utmCampaigns.find((r) => r.key === "sept")?.leads, 2);
  assert.equal(report.referrers.find((r) => r.key === DIRECT)?.leads, 2);
});

test("aggregatePagePerformance handles an empty period", () => {
  const report = aggregatePagePerformance([]);
  assert.deepEqual(report.totals, { leads: 0, withLandingPage: 0, withoutLandingPage: 0, admissions: 0, conversionRate: "0" });
  assert.deepEqual(report.pages, []);
  assert.deepEqual(report.referrers, []);
});
