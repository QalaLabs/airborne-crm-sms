// Safe rendering rules for admin-authored CMS content. Mirrors the public
// website's src/lib/cms/safeContent.js so the admin preview shows exactly what
// the website renders: rich text becomes an allow-listed element tree (never
// raw HTML) and only scheme-checked links survive.

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (url.startsWith("#")) return url;
  if (url.startsWith("/")) return url.startsWith("//") || url.startsWith("/\\") ? null : url;
  try {
    return SAFE_SCHEMES.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

export function safeMediaSrc(value: unknown): string | null {
  const href = safeHref(value);
  if (!href || href.startsWith("#") || /^(mailto|tel):/i.test(href)) return null;
  return href;
}

export function videoEmbedUrl(src: unknown): string | null {
  try {
    const url = new URL(String(src ?? "").trim());
    if (url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^www\./, "");
    let id: string | null = null;
    if ((host === "youtube.com" || host === "m.youtube.com") && url.pathname === "/watch") id = url.searchParams.get("v");
    else if (host === "youtu.be") id = url.pathname.slice(1);
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === "vimeo.com") {
      const v = url.pathname.slice(1).split("/")[0] ?? "";
      if (/^\d{3,15}$/.test(v)) return `https://player.vimeo.com/video/${v}`;
    }
  } catch {
    // not a URL
  }
  return null;
}

export type RichNode =
  | { t: "text"; v: string }
  | { t: "el"; tag: string; children: RichNode[]; href?: string; newTab?: boolean };

const ALLOWED = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "code", "pre", "a", "hr", "span", "div"]);
const RENAME: Record<string, string> = { h1: "h2", h5: "h4", h6: "h4" };
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr", "area", "base", "col", "embed", "param", "track"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "textarea", "title", "select", "frameset", "frame", "applet", "head"]);
const MAX_DEPTH = 32;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(cp);
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

function readAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

export function parseRichText(html: unknown): RichNode[] {
  const root: Extract<RichNode, { t: "el" }> = { t: "el", tag: "root", children: [] };
  const stack: Extract<RichNode, { t: "el" }>[] = [root];
  const tokens = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  const src = String(html ?? "");
  let dropping: string | null = null;
  let dropDepth = 0;
  let m: RegExpExecArray | null;
  while ((m = tokens.exec(src))) {
    const [whole, closing, rawName, rawAttrs, text] = m;
    const top = stack[stack.length - 1]!;
    if (whole.startsWith("<!--")) continue;
    if (dropping) {
      if (rawName && rawName.toLowerCase() === dropping) dropDepth += closing ? -1 : whole.endsWith("/>") ? 0 : 1;
      if (dropDepth === 0) dropping = null;
      continue;
    }
    if (text !== undefined || !rawName) {
      top.children.push({ t: "text", v: decodeEntities(text ?? whole) });
      continue;
    }
    const name = rawName.toLowerCase();
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !whole.endsWith("/>") && !VOID.has(name)) {
        dropping = name;
        dropDepth = 1;
      }
      continue;
    }
    const tag = RENAME[name] ?? name;
    if (closing) {
      const idx = stack.map((n) => n.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    const node: Extract<RichNode, { t: "el" }> = { t: "el", tag, children: [] };
    if (tag === "a") {
      const attrs = readAttrs(rawAttrs ?? "");
      const href = safeHref(attrs.href);
      if (href) node.href = href;
      if (href && attrs.target === "_blank") node.newTab = true;
    }
    top.children.push(node);
    if (!VOID.has(tag) && !whole.endsWith("/>") && stack.length < MAX_DEPTH) stack.push(node);
  }
  return root.children;
}
