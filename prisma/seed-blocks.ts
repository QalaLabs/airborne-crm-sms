import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type BlockDef = {
  type: string;
  name: string;
  description: string;
  category: string;
  schema: Record<string, unknown>;
  defaultProps: Record<string, unknown>;
  isGlobal: boolean;
};

const BLOCK_TYPES: BlockDef[] = [
  {
    type: "heading",
    name: "Heading",
    description: "Section heading with configurable level and alignment.",
    category: "Basic",
    schema: {
      type: "object",
      properties: {
        content: { type: "string", title: "Heading text", ui: "textarea" },
        level: { type: "number", title: "Heading level", enum: [1, 2, 3, 4] },
        align: { type: "string", title: "Alignment", enum: ["left", "center", "right"] },
      },
      required: ["content"],
    },
    defaultProps: { content: "New Heading", level: 2, align: "left" },
    isGlobal: false,
  },
  {
    type: "text",
    name: "Text",
    description: "A paragraph of plain text.",
    category: "Basic",
    schema: {
      type: "object",
      properties: {
        content: { type: "string", title: "Text", ui: "textarea" },
        align: { type: "string", title: "Alignment", enum: ["left", "center", "right"] },
      },
      required: ["content"],
    },
    defaultProps: { content: "", align: "left" },
    isGlobal: false,
  },
  {
    type: "rich_text",
    name: "Rich Text",
    description: "Formatted HTML content block.",
    category: "Basic",
    schema: {
      type: "object",
      properties: {
        content: { type: "string", title: "Content (HTML)", ui: "richtext" },
      },
      required: ["content"],
    },
    defaultProps: { content: "" },
    isGlobal: false,
  },
  {
    type: "image",
    name: "Image",
    description: "A single image with alt text and caption.",
    category: "Media",
    schema: {
      type: "object",
      properties: {
        src: { type: "string", title: "Image URL", ui: "url" },
        alt: { type: "string", title: "Alt text" },
        caption: { type: "string", title: "Caption" },
        objectFit: { type: "string", title: "Object fit", enum: ["cover", "contain"] },
      },
      required: ["src"],
    },
    defaultProps: { src: "", alt: "", caption: "", objectFit: "cover" },
    isGlobal: false,
  },
  {
    type: "video",
    name: "Video",
    description: "Embedded video player via URL.",
    category: "Media",
    schema: {
      type: "object",
      properties: {
        src: { type: "string", title: "Video URL", ui: "url" },
        title: { type: "string", title: "Title" },
        aspectRatio: { type: "string", title: "Aspect ratio", enum: ["16/9", "4/3", "1/1"] },
      },
      required: ["src"],
    },
    defaultProps: { src: "", title: "", aspectRatio: "16/9" },
    isGlobal: false,
  },
  {
    type: "button",
    name: "Button",
    description: "Call-to-action button with link and variant.",
    category: "Basic",
    schema: {
      type: "object",
      properties: {
        label: { type: "string", title: "Label" },
        href: { type: "string", title: "Link URL", ui: "url" },
        variant: { type: "string", title: "Variant", enum: ["primary", "secondary", "outline", "ghost"] },
        target: { type: "string", title: "Open in", enum: ["_self", "_blank"] },
      },
      required: ["label", "href"],
    },
    defaultProps: { label: "Learn More", href: "", variant: "primary", target: "_self" },
    isGlobal: false,
  },
  {
    type: "spacer",
    name: "Spacer",
    description: "Vertical spacing helper.",
    category: "Layout",
    schema: {
      type: "object",
      properties: {
        height: { type: "number", title: "Height (px)", ui: "number" },
      },
      required: [],
    },
    defaultProps: { height: 48 },
    isGlobal: true,
  },
];

async function main() {
  const orgSlug = process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation";

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    throw new Error(`Organization with slug "${orgSlug}" not found. Run "npm run db:seed" first.`);
  }

  console.log(`\n🌱 Seeding content block registry for org "${org.slug}" (${org.id})...\n`);

  for (const def of BLOCK_TYPES) {
    const block = await prisma.contentBlock.upsert({
      where: { orgId_type: { orgId: org.id, type: def.type } },
      update: {
        name: def.name,
        description: def.description,
        schema: def.schema as Prisma.InputJsonValue,
        defaultProps: def.defaultProps as Prisma.InputJsonValue,
        category: def.category,
        isGlobal: def.isGlobal,
      },
      create: {
        orgId: org.id,
        type: def.type,
        name: def.name,
        description: def.description,
        schema: def.schema as Prisma.InputJsonValue,
        defaultProps: def.defaultProps as Prisma.InputJsonValue,
        category: def.category,
        isGlobal: def.isGlobal,
      },
    });
    console.log(`  ✅ ${block.type.padEnd(10)} ${block.name} (${block.id})`);
  }

  const total = await prisma.contentBlock.count({ where: { orgId: org.id } });
  console.log(`\n🎉 Block registry seed complete. ${total} block types available.\n`);
}

main()
  .catch((e) => {
    console.error("❌ Block seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
