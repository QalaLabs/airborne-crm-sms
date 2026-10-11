"use client";

import { ResourceManager } from "@/components/cms/resource-manager";

export default function ResourcesPage() {
  return (
    <ResourceManager
      title="Resources"
      description="resources, guides and downloadable content"
      emptyTitle="No resources found"
      emptyDescription="Create your first resource to get started."
    />
  );
}
