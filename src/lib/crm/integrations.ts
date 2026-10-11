import { apiFetch } from "@/lib/api";
import type { IntegrationsData } from "./types";

export async function getIntegrationsData(): Promise<IntegrationsData> {
  return apiFetch<IntegrationsData>("/crm/integrations");
}
