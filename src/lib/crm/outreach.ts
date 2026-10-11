import { apiFetch } from "@/lib/api";
import type { OutreachData, OutreachTemplate } from "./types";

export async function getOutreachData(): Promise<OutreachData> {
  return apiFetch<OutreachData>("/crm/outreach");
}

export interface TemplateInput {
  event: OutreachTemplate["event"];
  channel: OutreachTemplate["channel"];
  name: string;
  subject?: string | null;
  body: string;
  variables?: string[];
  isActive?: boolean;
}

export async function toggleTemplate(id: string, isActive: boolean): Promise<OutreachTemplate> {
  return apiFetch<OutreachTemplate>("/crm/outreach", {
    method: "POST",
    body: JSON.stringify({ action: "toggle", id, isActive }),
  });
}

export async function createTemplate(input: TemplateInput): Promise<OutreachTemplate> {
  return apiFetch<OutreachTemplate>("/crm/outreach", {
    method: "POST",
    body: JSON.stringify({ action: "create", ...input }),
  });
}
