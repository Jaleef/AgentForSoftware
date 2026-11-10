/**
 * 需求/设计子系统分类。
 *
 * 根据带编号的章节路径统计，让 LLM 归纳少量子系统类别并建立路径映射。
 */

import type { SubsystemCategory } from "../types.js";
import { mapLimit, type LlmClient } from "./client.js";
import { cleanText } from "../util/text.js";

export interface TaxonomyResult {
  categories: SubsystemCategory[];
  /** chapterPath (joined with " / ") -> category name */
  mapping: Map<string, string>;
  warnings: string[];
  usedLlm: boolean;
}

interface ChapterStat {
  chapterPath: string[];
  count: number;
  samples: string[];
}

/** Minimal shape shared by requirement points and design points. */
export interface TaxonomyPoint {
  chapterPath?: string[];
  chapter?: string;
  description?: string;
  text?: string;
}

interface TaxonomyCategoryRaw {
  name?: string;
  description?: string;
}

interface TaxonomyAssignmentRaw {
  chapterPath?: string;
  chapter?: string;
  category?: string;
}

interface TaxonomyPayload {
  categories?: TaxonomyCategoryRaw[];
  assignments?: TaxonomyAssignmentRaw[];
}

const TAXONOMY_SYSTEM = `你是资深需求架构师。下面是从一份软件需求文档中统计出的章节路径（含编号）、需求点数量和样例标题。
任务：把这些章节归纳为少量、概括、稳定的“子系统/范围类别”，并为每个章节路径分配一个类别。
规则：
1. 类别数量控制在 3-8 个；内容确实复杂时最多 10 个。
2. 类别名要概括，例如“数字孪生平台”“降水仪”“重力波仪”“测云仪”“全局/其他”；不要把“数据库同步”“用户信息管理”“故障检测”等具体功能名当作子系统。
3. 优先按产品/平台/仪器/业务域划分，而不是按文档目录逐节划分。
4. 每个输入章节路径必须且只能分配到一个类别。
5. 类别名保持稳定、简短（不超过 20 个汉字）。
只输出 JSON：
{"categories":[{"name":"数字孪生平台","description":"..."}],"assignments":[{"chapterPath":"3 需求分析 / 3.3 功能需求 / 3.3.1 ...","category":"数字孪生平台"}]}`;

function pointChapterPath(point: TaxonomyPoint): string[] {
  if (point.chapterPath?.length) return point.chapterPath;
  return point.chapter ? point.chapter.split(" / ").filter(Boolean) : ["未分类"];
}

/**
 * 从章节路径归纳子系统类别。
 *
 * 统计路径、调用 LLM、校验类别和路径映射，并限制类别数量。
 */
export async function generateSubsystemTaxonomy(
  points: TaxonomyPoint[],
  client: LlmClient,
): Promise<TaxonomyResult> {
  const stats = new Map<string, ChapterStat>();
  for (const point of points) {
    const chapterPath = pointChapterPath(point);
    const key = chapterPath.join(" / ");
    const current = stats.get(key) ?? { chapterPath, count: 0, samples: [] };
    current.count++;
    const sample = (point.description || point.text || "").slice(0, 60);
    if (sample && current.samples.length < 2) current.samples.push(sample);
    stats.set(key, current);
  }

  const warnings: string[] = [];
  const chapters = [...stats.values()].sort((a, b) => b.count - a.count);
  if (!chapters.length) return { categories: [], mapping: new Map(), warnings, usedLlm: false };

  // Keep the prompt bounded for very large documents. Unmapped paths fall back to 全局.
  const limited = chapters.slice(0, 120);
  if (chapters.length > limited.length) {
    warnings.push(`章节数量较多，仅提交前 ${limited.length} 个章节用于子系统归纳；其余需求归入全局。`);
  }

  try {
    const payload = limited.map((chapter) => ({
      chapterPath: chapter.chapterPath.join(" / "),
      count: chapter.count,
      samples: chapter.samples,
    }));
    const response = await client.chatJson<TaxonomyPayload | TaxonomyCategoryRaw[] | TaxonomyAssignmentRaw[]>(
      [
        { role: "system", content: TAXONOMY_SYSTEM },
        { role: "user", content: `章节统计：\n${JSON.stringify(payload, null, 2)}` },
      ],
      { temperature: 0.1, maxTokens: 8192 },
    );

    // Some OpenAI-compatible models ignore the requested object envelope and
    // return a bare array. Accept both shapes instead of discarding a valid
    // taxonomy.
    const rawArray = Array.isArray(response) ? response : [];
    const arrayLooksLikeAssignments =
      rawArray.length > 0 &&
      rawArray.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          ("chapterPath" in item || "chapter" in item || "category" in item),
      );
    const rawCategories: TaxonomyCategoryRaw[] = Array.isArray(response)
      ? arrayLooksLikeAssignments
        ? []
        : (rawArray as TaxonomyCategoryRaw[])
      : Array.isArray(response.categories)
        ? response.categories
        : [];
    let rawAssignments: TaxonomyAssignmentRaw[] = Array.isArray(response)
      ? arrayLooksLikeAssignments
        ? (rawArray as TaxonomyAssignmentRaw[])
        : []
      : Array.isArray(response.assignments)
        ? response.assignments
        : [];
    let names: string[] = [];
    for (const category of rawCategories) {
      const name = cleanText(category.name || "").slice(0, 40);
      if (name && !names.includes(name)) names.push(name);
    }
    // If the model returned assignments only, derive category names from them.
    for (const assignment of rawAssignments) {
      const name = cleanText(assignment.category || "").slice(0, 40);
      if (name && !names.includes(name)) names.push(name);
    }
    if (names.length > 10) {
      warnings.push(`LLM 返回了 ${names.length} 个子系统类别，已截断为前 10 个。`);
      names = names.slice(0, 10);
    }
    if (!names.length) {
      warnings.push("LLM 未返回有效的子系统类别，需求单元将归入全局。");
      return { categories: [], mapping: new Map(), warnings, usedLlm: false };
    }

    // DeepSeek sometimes returns only the category list and omits assignments.
    // Ask a narrower question per batch; one large assignment object can be
    // truncated before the closing brace and fail JSON parsing.
    if (!rawAssignments.length && chapters.length) {
      const batchSize = 40;
      const assignmentBatches: Array<typeof limited> = [];
      for (let start = 0; start < limited.length; start += batchSize) {
        assignmentBatches.push(limited.slice(start, start + batchSize));
      }
      const batchResults = await mapLimit(
        assignmentBatches,
        3,
        async (batch, batchIndex) => {
          try {
            const assignmentResponse = await client.chatJson<
              TaxonomyPayload | TaxonomyAssignmentRaw[]
            >(
              [
                {
                  role: "system",
                  content:
                    "你是子系统分类助手。只能从给定的 categories 中为每个 chapterPath 选择一个 category。只输出 JSON：{\"assignments\":[{\"chapterPath\":\"...\",\"category\":\"...\"}]}。不要输出其他内容。",
                },
                {
                  role: "user",
                  content: `categories：\n${JSON.stringify(names, null, 2)}\n\nchapters：\n${JSON.stringify(
                    batch.map((chapter) => chapter.chapterPath.join(" / ")),
                    null,
                    2,
                  )}`,
                },
              ],
              { temperature: 0, maxTokens: 4096 },
            );
            return Array.isArray(assignmentResponse)
              ? (assignmentResponse as TaxonomyAssignmentRaw[])
              : Array.isArray(assignmentResponse.assignments)
                ? assignmentResponse.assignments
                : [];
          } catch (err) {
            warnings.push(
              `子系统章节映射第 ${batchIndex + 1} 批失败：${(err as Error).message}`,
            );
            return [];
          }
        },
      );
      rawAssignments = batchResults.flat();
    }

    const allowed = new Set(names);
    const mapping = new Map<string, string>();
    const chapterPaths = new Map<string, string[]>();
    for (const assignment of rawAssignments) {
      const chapterPath = cleanText(assignment.chapterPath || assignment.chapter || "");
      const category = cleanText(assignment.category || "");
      if (!chapterPath || !allowed.has(category)) continue;
      // Only accept chapter paths that were actually supplied.
      if (!stats.has(chapterPath)) continue;
      mapping.set(chapterPath, category);
      const paths = chapterPaths.get(category) ?? [];
      paths.push(chapterPath);
      chapterPaths.set(category, paths);
    }

    const categories: SubsystemCategory[] = names.map((name) => ({
      name,
      description: cleanText(rawCategories.find((category) => cleanText(category.name || "") === name)?.description || ""),
      chapterPaths: chapterPaths.get(name) ?? [],
    }));

    const missing = chapters.filter((chapter) => !mapping.has(chapter.chapterPath.join(" / "))).length;
    if (missing > 0) warnings.push(`${missing} 个章节未被 LLM 分配到子系统类别，相关需求将归入全局。`);

    return { categories, mapping, warnings, usedLlm: mapping.size > 0 };
  } catch (err) {
    warnings.push(`子系统分类生成失败：${(err as Error).message}`);
    return { categories: [], mapping: new Map(), warnings, usedLlm: false };
  }
}

/** Map a point to the taxonomy category, with parent-prefix fallback. */
export function taxonomyCategoryFor(point: TaxonomyPoint, mapping: Map<string, string>): string {
  if (!mapping.size) return "全局";
  const path = pointChapterPath(point);
  for (let length = path.length; length > 0; length--) {
    const key = path.slice(0, length).join(" / ");
    const category = mapping.get(key);
    if (category) return category;
  }
  return "全局";
}
