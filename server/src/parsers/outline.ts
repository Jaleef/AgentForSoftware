import type { OutlineNode } from "../types.js";

export interface HeadingRef {
  level: number;
  title: string;
  page: number;
}

export function buildOutline(headings: HeadingRef[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const h of headings) {
    if (!h.title) continue;
    const node: OutlineNode = { level: h.level, title: h.title, page: h.page, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}
