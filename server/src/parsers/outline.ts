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

export function subsystemFromText(text: string): string {
  if (/降水/.test(text)) return "降水仪";
  if (/重力波/.test(text)) return "重力波仪";
  if (/测云/.test(text)) return "测云仪";
  if (/平台|集成|系统架构|总体/.test(text)) return "数字孪生平台";
  return "";
}

export function normalizeSubsystem(value: string): string {
  const v = subsystemFromText(value);
  return v || "全局";
}
