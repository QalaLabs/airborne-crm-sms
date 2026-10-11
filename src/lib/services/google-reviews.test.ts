import test from "node:test";
import assert from "node:assert/strict";
import { getGoogleReviews, mapPlaceResponse, resetGoogleReviewsCache } from "./google-reviews";

const place = {
  displayName: { text: "Airborne Aviation Academy" },
  rating: 4.8,
  userRatingCount: 120,
  googleMapsUri: "https://maps.google.com/?cid=1",
  reviews: [
    {
      rating: 5,
      text: { text: "Great ground classes." },
      relativePublishTimeDescription: "a month ago",
      authorAttribution: { displayName: "Riya", uri: "https://www.google.com/maps/contrib/1", photoUri: "https://lh3.googleusercontent.com/a" },
    },
    { rating: 2, text: { text: "Not for me." }, authorAttribution: { displayName: "Low" } },
    { rating: 5, text: { text: "" }, authorAttribution: { displayName: "Empty" } },
    { rating: 4, originalText: { text: "Bahut accha." }, authorAttribution: { displayName: "Aman", uri: "javascript:alert(1)" } },
  ],
};

test("mapPlaceResponse keeps 4+ star reviews with text and drops unsafe URLs", () => {
  const out = mapPlaceResponse(place);
  assert.equal(out.configured, true);
  assert.equal(out.rating, 4.8);
  assert.equal(out.totalReviews, 120);
  assert.deepEqual(out.reviews.map((r) => r.author), ["Riya", "Aman"]);
  assert.equal(out.reviews[1]!.text, "Bahut accha.");
  assert.equal(out.reviews[1]!.authorUrl, null);
});

test("getGoogleReviews is not configured without key + place id and never calls Google", async () => {
  resetGoogleReviewsCache();
  const prev = { k: process.env.GOOGLE_PLACES_API_KEY, p: process.env.GOOGLE_PLACE_ID };
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACE_ID;
  let calls = 0;
  try {
    const out = await getGoogleReviews((async () => { calls++; throw new Error("no"); }) as unknown as typeof fetch);
    assert.equal(out.configured, false);
    assert.equal(calls, 0);
  } finally {
    if (prev.k !== undefined) process.env.GOOGLE_PLACES_API_KEY = prev.k;
    if (prev.p !== undefined) process.env.GOOGLE_PLACE_ID = prev.p;
  }
});

test("getGoogleReviews sends the key + field mask and caches within the TTL", async () => {
  resetGoogleReviewsCache();
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.GOOGLE_PLACE_ID = "ChIJtest";
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, headers: init.headers });
    return { ok: true, status: 200, json: async () => place };
  }) as unknown as typeof fetch;
  const origErr = console.error;
  console.error = () => {};
  try {
    const first = await getGoogleReviews(fakeFetch);
    assert.equal(first.reviews.length, 2);
    assert.match(seen[0]!.url, /places\/ChIJtest\?languageCode=en$/);
    assert.equal(seen[0]!.headers["X-Goog-Api-Key"], "test-key");
    assert.match(seen[0]!.headers["X-Goog-FieldMask"]!, /reviews/);

    await getGoogleReviews(fakeFetch);
    assert.equal(seen.length, 1, "second call within TTL must be served from cache");
  } finally {
    console.error = origErr;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACE_ID;
    resetGoogleReviewsCache();
  }
});
