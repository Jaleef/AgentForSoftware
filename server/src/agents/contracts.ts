/**
 * 主/子 Agent 契约。
 *
 * 主 Agent 负责编排；子 Agent 只做有明确输入输出的 LLM 任务，不直接写存储。
 */

import type { AgentRun } from "../types.js";
import type { LlmClient } from "../llm/client.js";

export interface AgentBudget {
  maxLlmCalls: number;
  maxDurationMs: number;
  startedAt: number;
}

export interface AgentLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface AgentContext {
  taskId: string;
  projectId: string;
  campaignId?: string;
  docId?: string;
  client?: LlmClient;
  signal: AbortSignal;
  budget: AgentBudget;
  agentRuns: AgentRun[];
  progress: (phase: string, done: number, total: number, message: string) => void;
  logger: AgentLogger;
}

export interface AgentResult<T> {
  data: T;
  warnings: string[];
  summary?: string;
}

export interface SubAgent<I, O> {
  name: string;
  version: string;
  stage: string;
  run(input: I, context: AgentContext): Promise<AgentResult<O>>;
}

export interface AgentContextOptions {
  taskId: string;
  projectId: string;
  campaignId?: string;
  docId?: string;
  client?: LlmClient;
  signal?: AbortSignal;
  maxLlmCalls?: number;
  maxDurationMs?: number;
  agentRuns?: AgentRun[];
  progress?: AgentContext["progress"];
  logger?: AgentLogger;
}
