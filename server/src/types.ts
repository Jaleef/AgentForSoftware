/**
 * 前后端共享的核心 TypeScript 类型。
 *
 * 定义文档、需求点/单元、设计点/单元、代码快照、评价关系、覆盖矩阵和设置结构。
 */

export type DocumentKind = "srs" | "sdd";

export type RequirementType =
  | "功能需求"
  | "性能需求"
  | "页面/人机交互需求"
  | "接口需求"
  | "数据需求"
  | "环境需求"
  | "安全保密需求"
  | "设计实现约束"
  | "验收交付需求"
  | "质量属性需求"
  | "元数据需求"
  | "用例需求"
  | "其他需求";

export const REQUIREMENT_TYPES: RequirementType[] = [
  "功能需求",
  "性能需求",
  "页面/人机交互需求",
  "接口需求",
  "数据需求",
  "环境需求",
  "安全保密需求",
  "设计实现约束",
  "验收交付需求",
  "质量属性需求",
  "元数据需求",
  "用例需求",
  "其他需求",
];

export type DesignUnitType = "模块" | "子功能" | "数据表" | "页面";

export interface SourceLocation {
  page: number;
  line: number;
}

/**
 * A raw requirement point before the LLM turns it into a structured requirement unit.
 * Table points come from the document structure and are trusted 100%.
 * Text points are only candidates until the LLM judges them.
 */
export interface RequirementPoint {
  id: string;
  kind: "table" | "text";
  origin: "rule" | "llm";
  confidence: number;
  chapter: string;
  /** Numbered heading levels, e.g. ["3 需求分析", "3.3 功能需求", "3.3.1 ..."]. */
  chapterPath: string[];
  location: SourceLocation;
  sourceId: string;
  parentSourceId: string;
  description: string;
  detail: string;
  testSpec: string;
  text: string;
  judged: boolean;
  accepted: boolean;
  reason: string;
}

export interface RequirementUnit {
  code: string;
  pointId?: string;
  sourceKind?: "table" | "text" | "manual";
  structureOrigin?: "rule" | "llm" | "manual";
  sourceId: string;
  parentSourceId: string;
  type: RequirementType;
  subsystem: string;
  title: string;
  description: string;
  detail: string;
  testSpec: string;
  chapter: string;
  chapterPath?: string[];
  location: SourceLocation;
  confidence: number;
  origin: "rule" | "llm" | "manual";
  summary: string;
  obligations: string[];
  keywords: string[];
  reviewStatus: "pending" | "confirmed";
  reviewNote: string;
}

/** A compact subsystem taxonomy generated from chapter statistics. */
export interface SubsystemCategory {
  name: string;
  description: string;
  chapterPaths: string[];
}

export interface DbField {
  name: string;
  meaning: string;
  type: string;
  length: string;
  primaryKey: boolean;
  defaultValue: string;
}

export interface DesignPoint {
  id: string;
  kind: "table" | "database" | "text";
  origin: "rule" | "llm";
  confidence: number;
  /** Structural hint for tables; text/database points may leave it empty for the LLM to decide. */
  typeHint: DesignUnitType | "";
  chapter: string;
  chapterPath: string[];
  location: SourceLocation;
  sourceId: string;
  parentSourceId: string;
  name: string;
  description: string;
  detail: string;
  interfaceText: string;
  input: string;
  output: string;
  fields: DbField[];
  text: string;
  judged: boolean;
  accepted: boolean;
  reason: string;
}

export interface DesignUnit {
  code: string;
  pointId?: string;
  sourceKind?: "table" | "database" | "text" | "manual";
  structureOrigin?: "rule" | "llm" | "manual";
  sourceId: string;
  parentSourceId: string;
  type: DesignUnitType;
  subsystem: string;
  name: string;
  description: string;
  detail: string;
  interfaceText: string;
  input: string;
  output: string;
  chapter: string;
  chapterPath?: string[];
  location: SourceLocation;
  confidence: number;
  origin: "rule" | "llm" | "manual";
  summary: string;
  obligations: string[];
  keywords: string[];
  fields: DbField[];
  reviewStatus: "pending" | "confirmed";
  reviewNote: string;
}

export interface OutlineNode {
  level: number;
  title: string;
  page: number;
  children: OutlineNode[];
}

export interface ParsedRequirements {
  kind: "srs";
  pageCount: number;
  requirements: RequirementUnit[];
  requirementPoints: RequirementPoint[];
  outline: OutlineNode[];
  stats: DocumentStats;
  warnings: string[];
}

export interface ParsedDesign {
  kind: "sdd";
  pageCount: number;
  designUnits: DesignUnit[];
  designPoints: DesignPoint[];
  outline: OutlineNode[];
  stats: DocumentStats;
  warnings: string[];
}

export type ParsedDocument = ParsedRequirements | ParsedDesign;

export interface DocumentStats {
  total: number;
  byType: Record<string, number>;
  bySubsystem: Record<string, number>;
  byChapter: Record<string, number>;
  pages: number;
  tables: number;
  paragraphs: number;
}

export interface StoredDocument {
  id: string;
  projectId: string;
  kind: DocumentKind;
  filename: string;
  originalName: string;
  size: number;
  sha256: string;
  version: string;
  uploadedAt: string;
  updatedAt: string;
  status: "parsed" | "parsing" | "enriching" | "failed";
  useLlm: boolean;
  error?: string;
  pageCount: number;
  requirements: RequirementUnit[];
  /** Raw points are kept so the LLM pipeline can be re-run without re-uploading. */
  requirementPoints?: RequirementPoint[];
  /** LLM-generated, compact subsystem taxonomy used by requirement units. */
  subsystemTaxonomy?: SubsystemCategory[];
  designUnits: DesignUnit[];
  /** Raw design points are kept so the design LLM pipeline can be re-run. */
  designPoints?: DesignPoint[];
  /** LLM-generated, compact subsystem taxonomy used by design units. */
  designSubsystemTaxonomy?: SubsystemCategory[];
  outline: OutlineNode[];
  stats: DocumentStats;
  warnings: string[];
  /** Recent agent executions for document enrichment audit. */
  agentRuns?: AgentRun[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type CodeSymbolKind =
  | "class"
  | "interface"
  | "enum"
  | "function"
  | "method"
  | "route"
  | "model"
  | "table"
  | "component";

export interface CodeSymbol {
  id: string;
  kind: CodeSymbolKind;
  name: string;
  file: string;
  line: number;
  signature: string;
  snippet: string;
}

export interface CodeFile {
  path: string;
  language: string;
  bytes: number;
  lines: number;
  symbols: CodeSymbol[];
}

export interface CodeSnapshot {
  id: string;
  projectId: string;
  rootPath: string;
  commit: string;
  createdAt: string;
  status: "ready" | "parsing" | "failed";
  error?: string;
  files: CodeFile[];
  stats: {
    files: number;
    lines: number;
    symbols: number;
    routes: number;
    models: number;
    byLanguage: Record<string, number>;
    skipped: number;
  };
  warnings: string[];
}

export interface CodeTreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  fileCount: number;
  files?: CodeFile[];
  children?: CodeTreeNode[];
}

export type RelationLevel = "requirement_design" | "design_code";

export type RelationStatus =
  | "satisfied"
  | "partial"
  | "missing"
  | "mismatch"
  | "divergent"
  | "unknown";

export const RELATION_STATUS_LABEL: Record<RelationStatus, string> = {
  satisfied: "已覆盖",
  partial: "部分覆盖",
  missing: "缺失",
  mismatch: "不一致",
  divergent: "偏离实现",
  unknown: "待确认",
};

export type ObligationCoverageStatus = "covered" | "partial" | "conflicting" | "missing";

export interface RelationObligation {
  id: string;
  text: string;
  status: ObligationCoverageStatus;
  coveredBy: string[];
}

export interface TargetCoverage {
  targetCode: string;
  targetName: string;
  coveredObligationIds: string[];
  partialObligationIds: string[];
  conflictingObligationIds: string[];
  contributionRatio: number;
  evidence: string;
  confidence: number;
}

export interface Relation {
  id: string;
  level: RelationLevel;
  sourceCode: string;
  sourceName: string;
  sourceType: string;
  sourceSubsystem: string;
  targetCodes: string[];
  targetNames: string[];
  status: RelationStatus;
  confidence: number;
  severity: "P0" | "P1" | "P2" | "none";
  rationale: string;
  evidence: string;
  gaps: string[];
  suggestions: string;
  method: "llm" | "heuristic";
  reviewStatus: "pending" | "accepted" | "rejected";
  reviewNote: string;
  coverageRatio?: number;
  targetCoverages?: TargetCoverage[];
  obligations?: RelationObligation[];
}

export interface ScoreBucket {
  key: string;
  total: number;
  satisfied: number;
  partial: number;
  missing: number;
  other: number;
  score: number;
}

export interface CampaignSummary {
  score: number;
  requirementCoverage: number;
  designCoverage: number;
  designCovered: number;
  designTotal: number;
  counts: {
    total: number;
    satisfied: number;
    partial: number;
    missing: number;
    mismatch: number;
    divergent: number;
  };
  gate: "pass" | "warn" | "fail";
  bySubsystem: ScoreBucket[];
  byType: ScoreBucket[];
  byLevel: Record<RelationLevel, { total: number; score: number }>;
  findings: {
    p0: number;
    p1: number;
    p2: number;
  };
}

export interface AgentRun {
  id: string;
  agent: string;
  version: string;
  stage: string;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  model?: string;
  promptVersion?: string;
  inputHash?: string;
  outputSummary?: string;
  warnings: string[];
  metrics?: {
    llmCalls: number;
    durationMs: number;
  };
  error?: string;
}

export interface Campaign {
  id: string;
  projectId: string;
  name: string;
  levels: RelationLevel[];
  subsystems: string[];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: {
    done: number;
    total: number;
    message: string;
  };
  provider: string;
  model: string;
  method: "llm" | "heuristic";
  relations: Relation[];
  summary?: CampaignSummary;
  warnings?: string[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** "agent" for the main/sub-agent pipeline; absent means legacy evaluation. */
  pipeline?: "legacy" | "agent";
  agentRuns?: AgentRun[];
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  concurrency: number;
  timeoutMs: number;
  jsonMode: boolean;
  mock: boolean;
}

export interface AppSettings {
  llm: LlmSettings;
}

export interface StoreData {
  version: number;
  projects: Project[];
  documents: StoredDocument[];
  snapshots: CodeSnapshot[];
  campaigns: Campaign[];
}

export interface ProjectOverview {
  project: Project;
  requirementDoc?: { id: string; originalName: string; status: string; uploadedAt: string; total: number; version: string };
  designDoc?: { id: string; originalName: string; status: string; uploadedAt: string; total: number; version: string };
  snapshot?: { id: string; rootPath: string; commit: string; createdAt: string; files: number; symbols: number };
  campaigns: number;
  latestCampaign?: { id: string; name: string; status: string; score?: number; createdAt: string };
  requirementStats: { total: number; byType: Record<string, number> };
  designStats: { total: number; byType: Record<string, number> };
}
