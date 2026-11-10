/**
 * Agent 上下文构造。
 */

import type { AgentContext, AgentContextOptions } from "./contracts.js";

const defaultLogger = {
  info: (message: string): void => console.log("[agent]", message),
  warn: (message: string): void => console.warn("[agent]", message),
};

export function createAgentContext(options: AgentContextOptions): AgentContext {
  return {
    taskId: options.taskId,
    projectId: options.projectId,
    campaignId: options.campaignId,
    docId: options.docId,
    client: options.client,
    signal: options.signal ?? new AbortController().signal,
    budget: {
      maxLlmCalls: options.maxLlmCalls ?? 500,
      maxDurationMs: options.maxDurationMs ?? 30 * 60 * 1000,
      startedAt: Date.now(),
    },
    agentRuns: options.agentRuns ?? [],
    progress: options.progress ?? (() => undefined),
    logger: options.logger ?? defaultLogger,
  };
}
