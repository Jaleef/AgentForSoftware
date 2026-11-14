---
id: ADR-0008
title: 回退主-从 Agent 架构，LLM 调用直连
status: accepted
date: 2026-11-14
deciders:
  - architecture
  - tech-lead
related_code:
  - server/src/services/documents.ts
  - server/src/evaluation/runner.ts
supersedes: ADR-0006
---

# ADR-0008：回退主-从 Agent 架构，LLM 调用直连

## 背景

ADR-0006 把文档整理和评价包装成「确定性主 Agent + 专用子 Agent」，引入了 `AgentContext`、运行器、预算和 `AgentRun` 审计。但本系统的 LLM 只承担两个固定任务：文档点判定/单元生成、评价覆盖判定；流程是确定的函数管道，不需要 Agent 编排、自主规划或工具调用。这层包装增加了间接性、状态字段和维护成本，也与「本地一致性评价工具」的定位不符。

## 决策

- 删除 `server/src/agents/`；
- 文档整理在 `services/documents.ts` 中直接调用 `runRequirementAgent` / `runDesignAgent`；
- 评价在 `evaluation/runner.ts` 中直接调用 `runEvaluation`，Runner 只负责任务生命周期、LLM 预检、进度持久化、取消和重启恢复；
- 删除 `AgentRun`、`StoredDocument.agentRuns`、`Campaign.agentRuns` 和 `Campaign.pipeline`；
- LLM 调用上限仍由 `LlmClient.setMaxCalls()` 控制。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| 保留主/子 Agent | 审计粒度细 | 多一层编排，字段和文档冗余 | 与实际需求不符 |
| 回退为直接函数调用 | 调用链短、易读易测 | 无 AgentRun 审计 | 采用 |

## 后果

- 文档整理与评价行为不变，只是少一层包装；
- 历史数据里残留的 `agentRuns` 字段会被忽略，不影响读取；
- 如果以后确实需要多步自主规划，再重新引入编排层，而不是现在预留。

## 验证

- `pnpm typecheck`、`vitest run` 通过；
- mock LLM 冒烟：SRS/SDD 整理成功，评价任务完成并生成 relations，输出中不再包含 `agentRuns` / `pipeline`。
