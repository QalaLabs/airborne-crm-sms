import type { PageModel } from "@/types";
import BlockRenderer from "@/components/cms/block-renderer";

export default function PublicPageRenderer({
  page,
  showTitle = true,
}: {
  page: PageModel;
  showTitle?: boolean;
}) {
  const visibleSections = page.sections
    .filter((s) => s.isVisible)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="mx-auto w-full max-w-4xl">
      {showTitle ? (
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
          {page.description ? (
            <p className="mt-2 text-muted-foreground">{page.description}</p>
          ) : null}
        </header>
      ) : null}

      {visibleSections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-12 text-center text-sm text-muted-foreground">
          This page has no visible sections yet.
        </div>
      ) : null}

      {visibleSections.map((section) => {
        const blocks = section.blocks
          .filter((b) => b.isVisible)
          .sort((a, b) => a.order - b.order);

        return (
          <section key={section.id} className="mb-8 space-y-4">
            {section.name ? (
              <h2 className="text-xl font-semibold tracking-tight">{section.name}</h2>
            ) : null}
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Empty section</p>
            ) : (
              blocks.map((block) => <BlockRenderer key={block.id} block={block} />)
            )}
          </section>
        );
      })}
    </div>
  );
}
