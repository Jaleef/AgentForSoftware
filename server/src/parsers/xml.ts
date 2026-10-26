export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function localName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  const target = localName(name);
  return node.children.find((c) => localName(c.name) === target);
}

export function children(node: XmlNode, name: string): XmlNode[] {
  const target = localName(name);
  return node.children.filter((c) => localName(c.name) === target);
}

export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  const target = localName(name);
  for (const c of node.children) {
    if (localName(c.name) === target) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

export function attr(node: XmlNode | undefined, name: string): string {
  if (!node) return "";
  if (name in node.attrs) return node.attrs[name];
  for (const key of Object.keys(node.attrs)) {
    if (localName(key) === name) return node.attrs[key];
  }
  return "";
}

export function textOf(node: XmlNode): string {
  if (node.text) return node.text;
  return "";
}

/** A small, tolerant XML parser sufficient for OOXML parts. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const len = xml.length;

  while (i < len) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      const text = xml.slice(i);
      if (text) stack[stack.length - 1].children.push({ name: "#text", attrs: {}, children: [], text });
      break;
    }
    if (lt > i) {
      const text = xml.slice(i, lt);
      if (text) stack[stack.length - 1].children.push({ name: "#text", attrs: {}, children: [], text });
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const text = xml.slice(lt + 9, end < 0 ? len : end);
      stack[stack.length - 1].children.push({ name: "#text", attrs: {}, children: [], text });
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      i = end < 0 ? len : end + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt + 2);
      i = end < 0 ? len : end + 1;
      continue;
    }
    const gt = findTagEnd(xml, lt + 1);
    if (gt < 0) break;
    const raw = xml.slice(lt + 1, gt);
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const content = selfClosing ? raw.slice(0, -1) : raw;
    const spaceIdx = content.search(/\s/);
    const name = (spaceIdx < 0 ? content : content.slice(0, spaceIdx)).trim();
    const attrs: Record<string, string> = {};
    if (spaceIdx >= 0) {
      const attrText = content.slice(spaceIdx + 1);
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(attrText))) {
        attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
      }
    }
    const node: XmlNode = { name, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  return root;
}

function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}
