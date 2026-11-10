---
id: ADR-0006
title: 采用确定性主 Agent + 专用子 Agent
status: accepted
date: 2026-11-08
deciders:
  - architecture
  - tech-lead
related_code:
  - server/src/agents
  - server/src/evaluation/runner.ts
supersedes: ""
---

# ADR-0006：采用确定性主 Agent + 专用子 Agent

## 背景

评价和文档整理包含多个 LLM 阶段，原实现分散在 `runner`、`services/documents`、`evaluation/engine` 中，缺少统一的任务边界、审计和预算控制。

## 决策

采用：

- 确定性 `MainAgent` 编排；
- 需求拆分、设计拆分、需求→设计判定、设计→代码判定拆为子 Agent；
- 解析、检索、覆盖聚合、评分、报告保持确定性 Tool；
- 子 Agent 不直接写 store；
- 记录 `AgentRun` 审计。

不采用 LLM 主 Agent 自由 tool-calling。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| 保持单函数流水线 | 改动最小 | 难审计、难恢复、边界不清 | 不满足演进 |
| LLM 主 Agent 自主调用工具 | 灵活 | 不可复现、难测试、预算不可控 | 风险过高 |
| 确定性主 Agent + 子 Agent | 可审计、可回退、可测试 | 多一层编排 | 采用 |

## 后果

- 现有 API 不变；
- 新增 `AgentRun` 和 `Campaign.agentRuns`；
- `runEvaluation` 保留兼容，runner 走新主 Agent；
- 子 Agent 失败可定位；
- 需要维护 Agent 契约和文档。

## 验证

`pnpm agents:smoke` 对比旧管线状态；现有 typecheck/build/smoke 继续通过。
