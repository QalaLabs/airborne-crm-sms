"use client";

import { useParams } from "next/navigation";
import PageEditor from "@/components/cms/page-editor";

export default function PageEditorRoute() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <PageEditor pageId={id} />;
}
