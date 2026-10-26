export type DocumentKind = "srs" | "sdd";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  requirementDoc?: {
    id: string;
    originalName: string;
    status: string;
    uploadedAt: string;
    total: number;
    version: string;
    pageCount: number;
  };
  designDoc?: {
    id: string;
    originalName: string;
    status: string;
    uploadedAt: string;
    total: number;
    version: string;
    pageCount: number;
  };
  snapshot?: {
    id: string;
    rootPath: string;
    commit: string;
    createdAt: string;
    files: number;
    symbols: number;
  };
  campaignCount: number;
  latestCampaign?: {
    id: string;
    name: string;
    status: string;
    score?: number;
    createdAt: string;
  };
  requirementStats: { total: number; byType: Record<string, number>; bySubsystem: Record<string, number> };
  designStats: { total: number; byType: Record<string, number>; bySubsystem: Record<string, number> };
}

export interface SourceLocation {
  page: number;
  line: number;
}

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

export interface DbField {
  name: string;
  meaning: string;
  type: string;
  length: string;
  primaryKey: boolean;
  defaultValue: string;
}

export interface DesignUnit {
  code: string;
  pointId?: string;
  sourceKind?: "table" | "database" | "text" | "manual";
  structureOrigin?: "rule" | "llm" | "manual";
  sourceId: string;
  parentSourceId: string;
  type: "模块" | "子功能" | "数据表" | "页面";
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
  requirementPoints?: unknown[];
  designUnits: DesignUnit[];
  designPoints?: unknown[];
  outline: OutlineNode[];
  stats: DocumentStats;
  warnings: string[];
}

export interface DocumentSummary {
  id: string;
  projectId: string;
  kind: DocumentKind;
  originalName: string;
  version: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  updatedAt: string;
  status: "parsed" | "parsing" | "enriching" | "failed";
  useLlm: boolean;
  error?: string;
  pageCount: number;
  stats: DocumentStats;
  warnings: string[];
  requirementCount: number;
  requirementPointCount?: number;
  designCount: number;
  designPointCount?: number;
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
  symbolCount?: number;
  symbols: CodeSymbol[];
}

export interface CodeTreeFile {
  name: string;
  path: string;
  type: "file";
  fileCount: number;
  files: CodeFile[];
}

export interface CodeTreeDir {
  name: string;
  path: string;
  type: "dir";
  fileCount: number;
  children: CodeTreeNode[];
}

export type CodeTreeNode = CodeTreeFile | CodeTreeDir;

export interface SnapshotMeta {
  id: string;
  projectId: string;
  rootPath: string;
  commit: string;
  createdAt: string;
  status: string;
  error?: string;
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
  tree?: CodeTreeNode;
}

export type RelationStatus = "satisfied" | "partial" | "missing" | "mismatch" | "divergent" | "unknown";

export interface Relation {
  id: string;
  level: "requirement_design" | "design_code";
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
  byLevel: Record<string, { total: number; score: number }>;
  findings: { p0: number; p1: number; p2: number };
}

export interface Campaign {
  id: string;
  projectId: string;
  name: string;
  levels: Array<"requirement_design" | "design_code">;
  subsystems: string[];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: { done: number; total: number; message: string };
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
}

export interface LlmSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  concurrency: number;
  timeoutMs: number;
  jsonMode: boolean;
  mock: boolean;
  hasApiKey: boolean;
  apiKeyHint: string;
}

export interface SettingsMeta {
  environment: "development" | "production";
  configSource: "env" | "settings";
  envFile: string;
  envLoaded: boolean;
  envActive: boolean;
  values: {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    apiKeyHint: string;
    mock: boolean;
  };
}

export interface SettingsResponse {
  settings: LlmSettings;
  configured: boolean;
  meta: SettingsMeta;
}

export const STATUS_LABEL: Record<RelationStatus, string> = {
  satisfied: "已覆盖",
  partial: "部分覆盖",
  missing: "缺失",
  mismatch: "不一致",
  divergent: "偏离",
  unknown: "待确认",
};

export const STATUS_TONE: Record<RelationStatus, string> = {
  satisfied: "green",
  partial: "amber",
  missing: "red",
  mismatch: "red",
  divergent: "purple",
  unknown: "gray",
};

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

export const SUBSYSTEMS = ["数字孪生平台", "降水仪", "重力波仪", "测云仪", "全局"];
