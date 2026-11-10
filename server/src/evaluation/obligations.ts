/**
 * 需求义务编号工具。
 *
 * 把需求单元的义务转成稳定的 O1..On，供义务级检索、覆盖矩阵和 UI 共同使用。
 */

import type { RequirementUnit } from "../types.js";
import { cleanText } from "../util/text.js";

export interface RequirementObligationItem {
  id: string;
  text: string;
}

/**
 * 把需求单元的义务转成 O1..On。
 *
 * 最多保留 8 条；没有义务时用 summary/description 生成一个合成义务。
 */
export function requirementObligations(unit: RequirementUnit): RequirementObligationItem[] {
  const texts = unit.obligations
    .map((text) => cleanText(text).slice(0, 240))
    .filter((text) => text.length >= 3)
    .slice(0, 8);
  if (!texts.length) {
    const fallback = cleanText(unit.summary || unit.description || unit.title).slice(0, 240);
    texts.push(fallback || "满足需求描述中的全部要求");
  }
  return texts.map((text, index) => ({ id: `O${index + 1}`, text }));
}
