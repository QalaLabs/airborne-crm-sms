import test from "node:test";
import assert from "node:assert/strict";
import { parseRichText, safeHref, safeMediaSrc, videoEmbedUrl, type RichNode } from "./safe-content";
import { updateNavMenuItemsSchema } from "@/lib/validations/nav.schema";

const text = (nodes: RichNode[]): string => nodes.map((n) => (n.t === "text" ? n.v : text(n.children))).join("");
const tags = (nodes: RichNode[]): string[] => nodes.flatMap((n) => (n.t === "el" ? [n.tag, ...tags(n.children)] : []));

test("admin preview rich text drops scripts, handlers and unsafe links", () => {
  const nodes = parseRichText(
    '<p onclick="x()">Hi <a href="&#106;avascript:alert(1)">bad</a> <a href="/ok">ok</a></p><script>alert(1)</script><iframe src="//x"></iframe>',
  );
  assert.deepEqual(tags(nodes), ["p", "a", "a"]);
  assert.equal(text(nodes), "Hi bad ok");
  const links = (nodes[0] as Extract<RichNode, { t: "el" }>).children.filter((n): n is Extract<RichNode, { t: "el" }> => n.t === "el");
  assert.deepEqual(links.map((l) => l.href), [undefined, "/ok"]);
});

test("admin safeHref / media / video match the website rules", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("/courses"), "/courses");
  assert.equal(safeMediaSrc("data:image/svg+xml,<svg/>"), null);
  assert.equal(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbedUrl("https://evil.example/watch?v=dQw4w9WgXcQ"), null);
});

test("nav menu items reject script-capable URLs and keep target/submenus", () => {
  const id = () => crypto.randomUUID();
  const good = updateNavMenuItemsSchema.parse({
    items: [{ id: id(), label: "Courses", url: "/courses", children: [{ id: id(), label: "CPL", url: "https://x.example", target: "_blank" }] }],
  });
  assert.equal(good.items[0]?.children?.[0]?.target, "_blank");
  for (const url of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "courses"]) {
    assert.equal(updateNavMenuItemsSchema.safeParse({ items: [{ id: id(), label: "X", url }] }).success, false, url);
    assert.equal(
      updateNavMenuItemsSchema.safeParse({ items: [{ id: id(), label: "P", url: "/p", children: [{ id: id(), label: "C", url }] }] }).success,
      false,
      `child ${url}`,
    );
  }
});
