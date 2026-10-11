/**
 * Public organization projection for unauthenticated endpoints (F01 fix).
 *
 * `organization.settings` is a free-form JSON blob and, by policy, must be
 * treated as sensitive by default: it has historically held webhook URLs,
 * provider API keys, the Google Ads webhook secret, and an `envVars` map with
 * live credentials. This module is the ONLY place that decides what public
 * website clients may see. It is an explicit allow-list, never a denylist —
 * arbitrary keys are simply not copied across.
 */

export const PUBLIC_ORG_SETTINGS_KEYS = [
  "applicationIntake", // closes/reopens public application intake (leads 403)
  "maintenanceMode", // 503 on public academy routes
] as const;

export type PublicOrgSettings = Partial<Record<(typeof PUBLIC_ORG_SETTINGS_KEYS)[number], unknown>>;

export function projectPublicOrgSettings(settings: unknown): PublicOrgSettings {
  const out: PublicOrgSettings = {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return out;
  const src = settings as Record<string, unknown>;
  for (const key of PUBLIC_ORG_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  return out;
}

export interface PublicOrgInput {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  domain: string | null;
  settings: unknown;
}

export interface PublicOrgPayload {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  domain: string | null;
  settings: PublicOrgSettings;
  navMenus: unknown[];
}

/**
 * Serialization shape for GET /api/public/settings. Keeps the historical
 * `data.{id,name,slug,logoUrl,domain,settings,navMenus}` contract while
 * guaranteeing `settings` is only ever the allow-listed projection.
 */
export function buildPublicOrgPayload(org: PublicOrgInput, navMenus: unknown[]): PublicOrgPayload {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logoUrl: org.logoUrl,
    domain: org.domain,
    settings: projectPublicOrgSettings(org.settings),
    navMenus,
  };
}