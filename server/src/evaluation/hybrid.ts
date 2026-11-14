/**
 * 义务级混合检索器。
 *
 * 检索通道：
 * - BM25F：字段加权的词面召回，擅长接口名、字段名和专有名词；
 * - Dense：可选的向量语义召回，解决同义改写；
 * - Legacy：保留原有 token 覆盖率/Jaccard 通道作为兜底；
 * - RRF：按排名融合多通道结果，再按义务命中数和结构特征重排。
 *
 * 未配置 EMBEDDING_MODEL 或向量调用失败时，自动退回 BM25F + Legacy。
 */

import MiniSearch from "minisearch";
import type { DesignUnit, RequirementUnit } from "../types.js";
import { cleanText, overlapScore, tokenSet, tokenize } from "../util/text.js";
import {
  designTypeAffinity,
  rankDesignCandidates,
  type DesignIndexEntry,
  type RankedDesign,
} from "./retrieval.js";
import { requirementObligations, type RequirementObligationItem } from "./obligations.js";
import { embedTexts, embeddingConfig } from "./embeddings.js";
import { rerankCandidates, rerankConfig } from "./rerank.js";

const RRF_K = 60;

const SEARCH_FIELDS = [
  "name",
  "interface",
  "obligations",
  "fields",
  "summary",
  "keywords",
  "description",
  "inputOutput",
  "subsystem",
] as const;

const SEARCH_BOOST: Record<string, number> = {
  name: 3.0,
  interface: 2.5,
  obligations: 2.0,
  fields: 1.5,
  summary: 1.5,
  keywords: 1.2,
  description: 1.0,
  inputOutput: 1.0,
  subsystem: 0.8,
};

interface SearchDocument {
  id: string;
  [field: string]: string;
}

interface DenseDoc {
  designCode: string;
  text: string;
  vector: number[];
}

export interface HybridChannelRanks {
  bm25: number | null;
  dense: number | null;
  legacy: number | null;
}

export interface HybridCandidate extends RankedDesign {
  rrfScore: number;
  obligationHits: number;
  channels: HybridChannelRanks;
}

export interface HybridRetriever {
  rank(requirement: RequirementUnit): Promise<HybridCandidate[]>;
  warnings: string[];
  denseEnabled: boolean;
}

export interface HybridRetrieverOptions {
  /** Number of candidates returned per requirement (before engine's Top 6 slice). */
  finalLimit?: number;
  /** Candidates taken from each channel per obligation. */
  channelLimit?: number;
  useDense?: boolean;
}

/**
 * 构造 MiniSearch 文档。
 *
 * 字段名和权重对应原 BM25F；MiniSearch 负责倒排索引、IDF、字段长度归一化
 * 和 BM25 打分，业务只需要提供字段文本和 boost。
 */
function searchDocument(unit: DesignUnit): SearchDocument {
  return {
    id: unit.code,
    name: unit.name,
    interface: unit.interfaceText,
    obligations: unit.obligations.join(" "),
    fields: unit.fields.map((field) => `${field.name} ${field.meaning}`).join(" "),
    summary: unit.summary,
    keywords: unit.keywords.join(" "),
    description: unit.description,
    inputOutput: `${unit.input} ${unit.output}`,
    subsystem: unit.subsystem,
  };
}

function obligationQueryText(requirement: RequirementUnit, obligation: RequirementObligationItem): string {
  return `${requirement.title} ${obligation.text}`;
}

function normalizeRanking(candidates: RankedDesign[], limit: number): string[] {
  return candidates.slice(0, limit).map((candidate) => candidate.unit.code);
}

function buildDenseDocs(units: DesignUnit[]): Array<{ designCode: string; text: string }> {
  const docs: Array<{ designCode: string; text: string }> = [];
  for (const unit of units) {
    docs.push({
      designCode: unit.code,
      text: [
        unit.name,
        unit.summary,
        unit.description,
        unit.interfaceText,
        ...unit.obligations,
        ...unit.keywords,
        ...unit.fields.map((field) => `${field.name} ${field.meaning}`),
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 2400),
    });
    for (const obligation of unit.obligations.slice(0, 8)) {
      docs.push({
        designCode: unit.code,
        text: `${unit.name} ${obligation}`.slice(0, 800),
      });
    }
  }
  return docs;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Build a reusable hybrid retriever for one evaluation run.
 *
 * This precomputes BM25F corpus statistics and, when enabled, all design and
 * requirement-obligation embeddings. The returned ranker is synchronous.
 */
export async function buildHybridRetriever(
  designUnits: DesignUnit[],
  requirements: RequirementUnit[],
  options: HybridRetrieverOptions = {},
): Promise<HybridRetriever> {
  const finalLimit = Math.max(1, options.finalLimit ?? 8);
  const channelLimit = Math.max(1, options.channelLimit ?? 16);
  const warnings: string[] = [];
  // 调用 MiniSearch 建立字段索引；tokenize 仍使用项目的业务分词器。
  const search = new MiniSearch<SearchDocument>({
    idField: "id",
    fields: [...SEARCH_FIELDS],
    tokenize: (text) => tokenize(text),
  });
  search.addAll(designUnits.map(searchDocument));
  const legacyIndex: DesignIndexEntry[] = designUnits.map((unit) => {
    const text = [
      unit.name,
      unit.summary,
      unit.description,
      unit.interfaceText,
      unit.input,
      unit.output,
      ...unit.obligations,
      ...unit.keywords,
      ...unit.fields.map((field) => `${field.name} ${field.meaning}`),
      unit.subsystem,
    ]
      .filter(Boolean)
      .join(" ");
    return { unit, tokens: tokenSet(text), nameTokens: tokenSet(`${unit.name} ${unit.interfaceText}`) };
  });

  let denseEnabled = false;
  let denseDocs: DenseDoc[] = [];
  const obligationVectorByText = new Map<string, number[]>();
  if (options.useDense !== false && embeddingConfig()) {
    try {
      const texts = buildDenseDocs(designUnits);
      const vectors = await embedTexts(texts.map((doc) => doc.text));
      if (!vectors) throw new Error("Embedding 未启用");
      denseDocs = texts.map((doc, index) => ({ ...doc, vector: vectors[index] }));
      const queryTexts = [...new Set(requirements.flatMap((requirement) =>
        requirementObligations(requirement).map((obligation) => obligationQueryText(requirement, obligation)),
      ))];
      const queryVectors = await embedTexts(queryTexts);
      if (!queryVectors) throw new Error("Embedding 查询向量未返回");
      queryTexts.forEach((text, index) => obligationVectorByText.set(text, queryVectors[index]));
      denseEnabled = true;
    } catch (error) {
      warnings.push(`向量召回已禁用，回退 BM25F/词面检索：${(error as Error).message}`);
      denseDocs = [];
      obligationVectorByText.clear();
    }
  }

  const codeToUnit = new Map(designUnits.map((unit) => [unit.code, unit]));

  function topBm25(queryText: string): string[] {
    // 调用 MiniSearch.search；字段 boost 对应原 BM25F 权重。
    return search
      .search(queryText, { boost: SEARCH_BOOST, combineWith: "OR" })
      .slice(0, channelLimit)
      .map((result) => String(result.id));
  }

  function topDense(queryText: string): string[] {
    const query = obligationVectorByText.get(queryText);
    if (!query) return [];
    const byCode = new Map<string, number>();
    for (const doc of denseDocs) {
      const score = cosine(query, doc.vector);
      const current = byCode.get(doc.designCode) ?? -1;
      if (score > current) byCode.set(doc.designCode, score);
    }
    return [...byCode.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, channelLimit)
      .map(([code]) => code);
  }

  async function rank(requirement: RequirementUnit): Promise<HybridCandidate[]> {
    const obligations = requirementObligations(requirement);
    const legacyRanking = normalizeRanking(
      rankDesignCandidates(requirement, legacyIndex, channelLimit),
      channelLimit,
    );
    const titleTokens = tokenSet(`${requirement.title} ${requirement.keywords.join(" ")}`);
    const aggregate = new Map<
      string,
      { rrfScore: number; obligationHits: number; obligationSet: Set<number>; channels: HybridChannelRanks }
    >();
    const addChannelHit = (
      code: string,
      rank: number,
      channel: keyof HybridChannelRanks,
      obligationIndex: number,
    ): void => {
      const current =
        aggregate.get(code) ?? {
          rrfScore: 0,
          obligationHits: 0,
          obligationSet: new Set<number>(),
          channels: { bm25: null, dense: null, legacy: null },
        };
      current.rrfScore += 1 / (RRF_K + rank);
      if (current.channels[channel] === null) current.channels[channel] = rank;
      if (channel !== "legacy") {
        current.obligationSet.add(obligationIndex);
        current.obligationHits = current.obligationSet.size;
      }
      aggregate.set(code, current);
    };

    obligations.forEach((obligation, obligationIndex) => {
      const queryText = obligationQueryText(requirement, obligation);
      topBm25(queryText).forEach((code, index) =>
        addChannelHit(code, index + 1, "bm25", obligationIndex),
      );
      topDense(queryText).forEach((code, index) =>
        addChannelHit(code, index + 1, "dense", obligationIndex),
      );
    });
    legacyRanking.forEach((code, index) =>
      addChannelHit(code, index + 1, "legacy", 0),
    );

    const candidates: HybridCandidate[] = [];
    for (const [code, value] of aggregate) {
      const unit = codeToUnit.get(code);
      if (!unit) continue;
      let structuralBonus = designTypeAffinity(requirement.type, unit.type);
      if (requirement.subsystem !== "全局" && unit.subsystem === requirement.subsystem) {
        structuralBonus += 0.09;
      }
      structuralBonus += overlapScore(titleTokens, tokenSet(`${unit.name} ${unit.interfaceText}`)) * 0.14;
      const obligationFactor = 1 + Math.min(0.2, value.obligationHits * 0.04);
      candidates.push({
        unit,
        score: value.rrfScore * (1 + structuralBonus) * obligationFactor,
        rrfScore: value.rrfScore,
        obligationHits: value.obligationHits,
        channels: value.channels,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const fused = candidates.slice(0, finalLimit);

    if (rerankConfig() && candidates.length) {
      try {
        const pool = candidates.slice(0, Math.min(20, candidates.length));
        const query = `${requirement.title} ${obligations.map((item) => item.text).join(" ")}`;
        const documents = pool.map((candidate) =>
          [
            candidate.unit.name,
            candidate.unit.summary,
            candidate.unit.interfaceText,
            ...candidate.unit.obligations.slice(0, 8),
          ]
            .filter(Boolean)
            .join(" ")
            .slice(0, 1200),
        );
        const reranked = await rerankCandidates(query, documents, finalLimit);
        if (reranked.length) {
          return reranked.map((item) => pool[item.index]).filter(Boolean);
        }
      } catch (error) {
        if (warnings.length < 4) warnings.push(`Cross-Encoder 重排失败，使用 RRF 结果：${(error as Error).message}`);
      }
    }
    return fused;
  }

  return { rank, warnings, denseEnabled };
}
