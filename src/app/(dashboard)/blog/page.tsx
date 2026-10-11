"use client";

import { ResourceManager } from "@/components/cms/resource-manager";

export default function BlogPage() {
  return (
    <ResourceManager
      title="Blog & Articles"
      description="expert aviation articles, DGCA exam study guides and press releases"
      emptyTitle="No articles yet"
      emptyDescription="Write and publish your first aviation article."
      defaultType="DOCUMENT"
      hideType
    />
  );
}
