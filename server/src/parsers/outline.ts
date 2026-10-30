/**
 * 标题大纲树构建。
 *
 * 按标题层级把平铺 heading 列表组装成树，不参与需求/设计类型判断。
 */

import type { OutlineNode } from "../types.js";

export interface HeadingRef {
  level: number;
  title: string;
  page: number;
}

/**
 * 把平铺标题列表组装为层级大纲树。
 *
 * 使用标题 level 维护父节点栈；只构建结构，不判断需求/设计类型。
 */
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
