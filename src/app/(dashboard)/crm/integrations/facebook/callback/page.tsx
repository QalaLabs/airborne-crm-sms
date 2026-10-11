import { redirect } from "next/navigation";

export default function FacebookOAuthCallbackRedirect() {
  redirect("/crm/integrations");
}
