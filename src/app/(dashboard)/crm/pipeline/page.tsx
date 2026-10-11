import { redirect } from "next/navigation";

export default function LegacyCRMPipelineRedirect() {
  redirect("/crm/lead-pipeline");
}
