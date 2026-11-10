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

const BM25_K1 = 1.35;
const BM25_B = 0.72;
const RRF_K = 60;

const BM25_FIELDS: Array<{ name: string; weight: number; text: (unit: DesignUnit) => string }> = [
  { name: "name", weight: 3.0, text: (unit) => unit.name },
  { name: "interface", weight: 2.5, text: (unit) => unit.interfaceText },
  { name: "obligations", weight: 2.0, text: (unit) => unit.obligations.join(" ") },
  { name: "fields", weight: 1.5, text: (unit) => unit.fields.map((field) => `${field.name} ${field.meaning}`).join(" ") },
  { name: "summary", weight: 1.5, text: (unit) => unit.summary },
  { name: "keywords", weight: 1.2, text: (unit) => unit.keywords.join(" ") },
  { name: "description", weight: 1.0, text: (unit) => unit.description },
  { name: "inputOutput", weight: 1.0, text: (unit) => `${unit.input} ${unit.output}` },
  { name: "subsystem", weight: 0.8, text: (unit) => unit.subsystem },
];

interface Bm25Field {
  tf: Map<string, number>;
  length: number;
}

interface Bm25Doc {
  unit: DesignUnit;
  fields: Map<string, Bm25Field>;
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

function docFieldStats(unit: DesignUnit): Map<string, Bm25Field> {
  const fields = new Map<string, Bm25Field>();
  for (const definition of BM25_FIELDS) {
    const tokens = tokenize(definition.text(unit));
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    fields.set(definition.name, { tf, length: tokens.length });
  }
  return fields;
}

function buildBm25Docs(units: DesignUnit[]): {
  docs: Bm25Doc[];
  df: Map<string, number>;
  avgLengths: Map<string, number>;
} {
  const docs = units.map((unit) => ({ unit, fields: docFieldStats(unit) }));
  const df = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set<string>();
    for (const [field, stat] of doc.fields) {
      totals.set(field, (totals.get(field) ?? 0) + stat.length);
      for (const term of stat.tf.keys()) {
        if (!seen.has(term)) {
          seen.add(term);
          df.set(term, (df.get(term) ?? 0) + 1);
        }
      }
    }
  }
  const avgLengths = new Map<string, number>();
  for (const field of BM25_FIELDS) {
    const total = totals.get(field.name) ?? 0;
    avgLengths.set(field.name, docs.length ? total / docs.length : 1);
  }
  return { docs, df, avgLengths };
}

function bm25Score(
  queryTokens: string[],
  doc: Bm25Doc,
  df: Map<string, number>,
  avgLengths: Map<string, number>,
  totalDocs: number,
): number {
  let score = 0;
  const unique = [...new Set(queryTokens)];
  for (const term of unique) {
    const docFreq = df.get(term) ?? 0;
    if (!docFreq) continue;
    const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
    let tfNorm = 0;
    for (const definition of BM25_FIELDS) {
      const stat = doc.fields.get(definition.name);
      if (!stat) continue;
      const tf = stat.tf.get(term) ?? 0;
      if (!tf) continue;
      const avg = avgLengths.get(definition.name) || 1;
      const norm = 1 - BM25_B + BM25_B * (stat.length / avg);
      const termScore = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm);
      tfNorm += definition.weight * termScore;
    }
    score += idf * tfNorm;
  }
  return score;
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
  const bm25 = buildBm25Docs(designUnits);
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
    const queryTokens = tokenize(queryText);
    const scored = bm25.docs
      .map((doc) => ({
        code: doc.unit.code,
        score: bm25Score(queryTokens, doc, bm25.df, bm25.avgLengths, bm25.docs.length),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, channelLimit);
    return scored.map((item) => item.code);
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
    const legacyRank = new Map(legacyRanking.map((code, index) => [code, index + 1]));
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
