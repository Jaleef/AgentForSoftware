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
  source: "llm" | "heuristic" | "none";
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
  if (!chapters.length) {
    return { categories: [], mapping: new Map(), warnings, usedLlm: false, source: "none" };
  }

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
      return { categories: [], mapping: new Map(), warnings, usedLlm: false, source: "none" };
    }

    // DeepSeek sometimes returns only the category list and omits assignments.
    // Ask a narrower question per batch; one large assignment object can be
    // truncated before the closing brace and fail JSON parsing.
    if (!rawAssignments.length && chapters.length) {
      // 20 章一批，避免 assignment JSON 接近输出上限被截断。
      const batchSize = 20;
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

    return { categories, mapping, warnings, usedLlm: mapping.size > 0, source: "llm" };
  } catch (err) {
    warnings.push(`子系统分类生成失败：${(err as Error).message}`);
    return { categories: [], mapping: new Map(), warnings, usedLlm: false, source: "none" };
  }
}

export type TaxonomyMode = "auto" | "llm" | "heuristic";

/** Taxonomy strategy: auto (default), force LLM, or force deterministic. */
export function taxonomyMode(): TaxonomyMode {
  const mode = (process.env.LLM_TAXONOMY ?? "auto").trim().toLowerCase();
  if (mode === "heuristic") return "heuristic";
  if (mode === "llm") return "llm";
  return "auto";
}

function chapterPathOf(point: TaxonomyPoint): string[] {
  if (point.chapterPath?.length) return point.chapterPath;
  return point.chapter ? point.chapter.split(" / ").filter(Boolean) : [];
}

function cleanChapterLabel(segment: string): string {
  let label = cleanText(segment);
  // Remove one or more leading numeric prefixes, including duplicated "3.3 3.3".
  label = label.replace(/^\s*\d+(?:\.\d+)*[.、\s]*/u, "").trim();
  label = label.replace(/^\s*\d+(?:\.\d+)*[.、\s]*/u, "").trim();
  return label.slice(0, 40);
}

interface GroupStat {
  key: string;
  path: string[];
  count: number;
}

/**
 * Deterministic taxonomy from numbered chapter paths.
 *
 * This is the default: it costs zero LLM calls and is stable across model
 * versions. It chooses a chapter depth that yields a useful number of groups,
 * caps the long tail into "其他", and maps points by exact chapter prefix.
 */
export function generateHeuristicTaxonomy(points: TaxonomyPoint[]): TaxonomyResult {
  const warnings: string[] = [];
  const pathCounts = new Map<number, number>();
  const paths = points.map(chapterPathOf).filter((path) => path.length > 0);
  if (!paths.length) {
    warnings.push("没有可用的章节路径，单元将归入“全局”。");
    return { categories: [], mapping: new Map(), warnings, usedLlm: false, source: "none" };
  }

  for (let depth = 1; depth <= 4; depth++) {
    const keys = new Set<string>();
    for (const path of paths) {
      if (path.length >= depth) keys.add(path.slice(0, depth).join(" / "));
    }
    pathCounts.set(depth, keys.size);
  }

  let depth = 1;
  const count = (d: number): number => pathCounts.get(d) ?? 0;
  if (count(2) >= 3 && count(2) <= 5) {
    depth = 2;
  } else if (count(1) >= 3 && count(1) <= 10 && count(2) > 10) {
    depth = 1;
  } else if (count(3) >= 3 && count(3) <= 25) {
    depth = 3;
  } else if (count(2) >= 3) {
    depth = 2;
  } else if (count(1) >= 3) {
    depth = 1;
  }

  const groups = new Map<string, GroupStat>();
  for (const path of paths) {
    const selected = path.slice(0, Math.min(depth, path.length));
    const key = selected.join(" / ");
    const current = groups.get(key) ?? { key, path: selected, count: 0 };
    current.count++;
    groups.set(key, current);
  }

  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const kept = sorted.slice(0, 8);
  const tail = sorted.slice(8);
  const names = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const group of [...kept, ...(tail.length ? [{ key: "其他", path: [], count: 0 }] : [])]) {
    if (group.key === "其他" && tail.length) {
      names.set("其他", "其他");
      continue;
    }
    const last = group.path[group.path.length - 1] ?? "其他";
    let label = cleanChapterLabel(last);
    if (!label) label = "其他";
    if (usedNames.has(label)) {
      const parent = group.path[group.path.length - 2];
      const parentLabel = parent ? cleanChapterLabel(parent) : "";
      label = parentLabel ? `${label}·${parentLabel}`.slice(0, 40) : `${label}${usedNames.size}`;
    }
    usedNames.add(label);
    names.set(group.key, label);
  }

  const mapping = new Map<string, string>();
  const chapterPaths = new Map<string, string[]>();
  for (const group of kept) {
    const category = names.get(group.key) ?? "其他";
    mapping.set(group.key, category);
    const pathsForCategory = chapterPaths.get(category) ?? [];
    pathsForCategory.push(group.key);
    chapterPaths.set(category, pathsForCategory);
  }
  if (tail.length) {
    const tailPaths = chapterPaths.get("其他") ?? [];
    for (const group of tail) {
      mapping.set(group.key, "其他");
      tailPaths.push(group.key);
    }
    chapterPaths.set("其他", tailPaths);
    warnings.push(`章节分组较多，仅保留前 8 类，其余 ${tail.length} 类归入“其他”。`);
  }

  const categories: SubsystemCategory[] = [...chapterPaths.entries()].map(([name, pathsForCategory]) => ({
    name,
    description: `按章节路径自动归纳：${pathsForCategory.slice(0, 2).join("；")}`,
    chapterPaths: pathsForCategory,
  }));

  return { categories, mapping, warnings, usedLlm: false, source: "heuristic" };
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

/**
 * 选择子系统分类策略。
 *
 * auto：先用章节路径启发式；如果“其他”占比超过 25% 或分类失败，再调用
 * LLM 做语义归纳。这样普通文档保持 0 次 taxonomy 调用，而混合章节结构
 * 的文档不会退化成“其他 53 条”。
 */
export async function resolveTaxonomy(
  points: TaxonomyPoint[],
  client: LlmClient,
): Promise<TaxonomyResult> {
  const heuristic = generateHeuristicTaxonomy(points);
  const mode = taxonomyMode();
  if (mode === "heuristic" || !points.length) return heuristic;

  const otherCount = points.filter(
    (point) => taxonomyCategoryFor(point, heuristic.mapping) === "其他",
  ).length;
  const poor =
    heuristic.source === "none" ||
    (heuristic.categories.length > 0 && otherCount > Math.max(2, Math.ceil(points.length * 0.25)));
  if (mode === "auto" && !poor) return heuristic;

  const llm = await generateSubsystemTaxonomy(points, client);
  if (llm.source === "none" || !llm.mapping.size) {
    return heuristic.source === "heuristic"
      ? { ...heuristic, warnings: [...heuristic.warnings, ...llm.warnings] }
      : llm;
  }
  return llm;
}
