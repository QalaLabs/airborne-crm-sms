const PLACES_URL = "https://places.googleapis.com/v1/places";
const FIELD_MASK = "displayName,rating,userRatingCount,googleMapsUri,reviews";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface GoogleReview {
  author: string;
  authorUrl: string | null;
  authorPhoto: string | null;
  rating: number;
  text: string;
  relativeTime: string | null;
  publishTime: string | null;
}

export interface GoogleReviewsPayload {
  configured: boolean;
  placeName: string | null;
  rating: number | null;
  totalReviews: number | null;
  mapsUrl: string | null;
  reviews: GoogleReview[];
}

const EMPTY: GoogleReviewsPayload = {
  configured: false,
  placeName: null,
  rating: null,
  totalReviews: null,
  mapsUrl: null,
  reviews: [],
};

function httpsOrNull(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("https://") ? v : null;
}

type PlaceResponse = {
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: Array<{
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    relativePublishTimeDescription?: string;
    publishTime?: string;
    authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
  }>;
};

export function mapPlaceResponse(place: PlaceResponse, minRating = 4): GoogleReviewsPayload {
  const reviews = (place.reviews ?? [])
    .map((r) => ({
      author: r.authorAttribution?.displayName?.trim() || "Google user",
      authorUrl: httpsOrNull(r.authorAttribution?.uri),
      authorPhoto: httpsOrNull(r.authorAttribution?.photoUri),
      rating: typeof r.rating === "number" ? r.rating : 0,
      text: (r.text?.text ?? r.originalText?.text ?? "").trim(),
      relativeTime: r.relativePublishTimeDescription ?? null,
      publishTime: r.publishTime ?? null,
    }))
    .filter((r) => r.text && r.rating >= minRating);

  return {
    configured: true,
    placeName: place.displayName?.text ?? null,
    rating: typeof place.rating === "number" ? place.rating : null,
    totalReviews: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    mapsUrl: httpsOrNull(place.googleMapsUri),
    reviews,
  };
}

let cache: { at: number; key: string; data: GoogleReviewsPayload } | null = null;

export async function getGoogleReviews(fetchImpl: typeof fetch = fetch): Promise<GoogleReviewsPayload> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const placeId = process.env.GOOGLE_PLACE_ID?.trim();
  if (!apiKey || !placeId) return EMPTY;

  if (cache && cache.key === placeId && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  try {
    const res = await fetchImpl(`${PLACES_URL}/${encodeURIComponent(placeId)}?languageCode=en`, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Places API ${res.status}`);
    const data = mapPlaceResponse((await res.json()) as PlaceResponse);
    cache = { at: Date.now(), key: placeId, data };
    return data;
  } catch (err) {
    console.error("[google-reviews] fetch failed:", err instanceof Error ? err.message : err);
    // Serve the last good copy rather than blanking the section on a transient failure.
    return cache?.key === placeId ? cache.data : { ...EMPTY, configured: true };
  }
}

export function resetGoogleReviewsCache() {
  cache = null;
}
