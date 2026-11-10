---
id: DOC-AGENT-001
title: Agent 架构
status: approved
owner: architecture
reviewers:
  - backend
  - tech-lead
last_reviewed: 2026-11-08
related_code:
  - server/src/agents
  - server/src/evaluation/runner.ts
---
# Agent 架构

## 1. 目标

把“文档整理”和“一致性评价”从单函数流水线改成：

```text
MainAgent（确定性编排）
  → 专用子 Agent（LLM 任务）
  → 确定性 Tool（检索/聚合/评分/报告）
```

主 Agent 不自由决定流程，子 Agent 不直接写存储。这样做的目的是：

- 每个 LLM 任务边界清晰；
- 每步可记录、可回退；
- 保持评价口径可复现；
- 失败时只影响一个阶段。

## 2. 角色划分

### MainAgent

当前实现：`server/src/agents/main-agent.ts`

职责：

- 按 `levels` 选择需求→设计 / 设计→代码子 Agent；
- 过滤子系统；
- 创建 `AgentContext`；
- 调用 `runSubAgent`；
- 合并关系；
- 用 `computeSummary` 重新计算全链路汇总；
- 返回 `agentRuns` 供 Campaign 持久化。

主 Agent 不做：

- 不直接解析 DOCX；
- 不直接调用 LLM；
- 不直接写 `store.json`；
- 不让 LLM 决定是否跳过校验。

### 子 Agent

| Agent                        | 文件                                             | 职责                                                           |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `requirement-split`        | `agents/subagents/requirement-split.agent.ts`  | 包装 `runRequirementAgent`：文本点判定 + taxonomy + 需求单元 |
| `design-split`             | `agents/subagents/design-split.agent.ts`       | 包装 `runDesignAgent`：设计点判定 + taxonomy + 设计单元      |
| `taxonomy`                 | `agents/subagents/taxonomy.agent.ts`           | 章节路径归纳子系统                                             |
| `requirement-design-judge` | `agents/subagents/requirement-design.agent.ts` | 义务级检索 + LLM 覆盖判定 + 覆盖率                             |
| `design-code-judge`        | `agents/subagents/design-code.agent.ts`        | 代码符号检索 + LLM 判定                                        |

### 确定性 Tool

不包装成 LLM Agent：

- DOCX 解析；
- `buildHybridRetriever`；
- `buildCoverageRelation`；
- `computeSummary`；
- Markdown/CSV/JSON 报告；
- store 读写。

## 3. 执行流程

### 3.1 文档整理

```text
runEnrichment
→ 预检 LLM
→ createAgentContext
→ RequirementSplitAgent / DesignSplitAgent
→ runSubAgent 记录 AgentRun
→ 主流程合并人工单元、写 StoredDocument
```

子 Agent 只返回 `RequirementAgentResult` / `DesignAgentResult`；持久化仍由文档服务完成。

### 3.2 评价

```text
startCampaignRun
→ runAgentEvaluation
→ RequirementDesignJudgeAgent
   → runEvaluation(levels=["requirement_design"])
   → hybrid retrieval + LLM targetCoverages
   → coverage matrix
→ DesignCodeJudgeAgent
   → runEvaluation(levels=["design_code"])
   → rankCodeCandidates + LLM
→ computeSummary(合并后的 relations)
→ Campaign.agentRuns
```

## 4. 上下文与审计

```ts
interface AgentContext {
  taskId: string;
  projectId: string;
  campaignId?: string;
  docId?: string;
  client?: LlmClient;
  signal: AbortSignal;
  budget: AgentBudget;
  agentRuns: AgentRun[];
  progress: ...;
  logger: ...;
}
```

`runSubAgent` 负责：

- 记录开始/结束时间；
- 记录 LLM 调用数（`LlmClient.calls` 差值）；
- 记录输入 hash；
- 记录 warnings/error；
- 写入 `AgentRun`。

## 5. 预算与取消

- `AgentBudget.maxLlmCalls` 通过 `LlmClient.setMaxCalls()` 形成硬上限；
- `maxDurationMs` 在子 Agent 启动前检查；
- `AbortSignal` 传给子 Agent 和 `runEvaluation`；
- 取消时 AgentRun 标记 `skipped`；
- 单次评价默认预算 500 次 LLM 调用；文档整理 300 次。

## 6. 失败策略

| 场景              | 行为                                                 |
| ----------------- | ---------------------------------------------------- |
| 无 LLM            | 子 Agent 使用规则回退                                |
| 单批 LLM 失败     | `runEvaluation` 内部该批回退启发式                 |
| 子 Agent 顶层失败 | 主 Agent 抛出，Campaign 标记 failed                  |
| 取消              | 停止后续子 Agent                                     |
| 预算耗尽          | 抛出明确错误，保留已完成阶段                         |
| 服务重启          | runner 将 running 标记 failed；AgentRun 已写入的不丢 |

## 7. 数据结构

```ts
interface AgentRun {
  id: string;
  agent: string;
  version: string;
  stage: string;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  model?: string;
  inputHash?: string;
  outputSummary?: string;
  warnings: string[];
  metrics?: { llmCalls: number; durationMs: number };
  error?: string;
}
```

- `Campaign.agentRuns`：评价阶段审计；
- `StoredDocument.agentRuns`：文档整理最近 20 次；
- `Campaign.pipeline="agent"` 标识新管线；
- 旧 Campaign 没有字段时按 legacy 处理。

## 8. 兼容性

- 所有现有 REST API 不变；
- `GET /campaigns/:id` 增加可选 `agentRuns`；
- `statusOnly=1` 只返回最近 5 条 AgentRun；
- `runEvaluation` 仍保留为旧调用门面；新 runner 使用 `runAgentEvaluation`；
- 旧数据不需要迁移。

## 9. 不采用 LLM 自主 tool-calling 的原因

- 评价必须可复现、可审计；
- 不能让 LLM 决定跳过义务校验；
- 多 Provider 的 tool calling 兼容性不一致；
- 回归测试困难；
- 预算/循环/错误处理不可控。

后续如需要，可增加受限 `PlannerAgent`，只选择 TopK/检索通道，不直接写结果。

## 10. 验证

```bash
pnpm agents:smoke
```

对比旧 `runEvaluation` 与新 Agent 管线的状态集合；当前示例结果为一致。

## 11. 相关文档

- [数据流](数据流.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [EVALUATION.md](EVALUATION.md)
- [测试与验收](测试与验收.md)
- [ADR-0006](adr/ADR-0006-main-sub-agent.md)
