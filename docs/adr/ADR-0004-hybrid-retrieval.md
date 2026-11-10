---
id: ADR-0004
title: 检索采用 BM25F + Dense + RRF + 可选 Rerank
status: accepted
date: 2026-11-08
deciders:
  - architecture
related_code:
  - server/src/evaluation/hybrid.ts
  - server/src/evaluation/embeddings.ts
  - server/src/evaluation/rerank.ts
  - server/src/evaluation/retrieval.ts
supersedes: ""
---

# ADR-0004：检索采用 BM25F + Dense + RRF + 可选 Rerank

## 背景

纯词面检索会漏掉同义改写；纯向量检索会漏掉接口名、字段名和模块编号。评价只把 Top 6 候选交给 LLM，召回错误无法在后端修复。

## 决策

- 按需求义务分别检索；
- BM25F 字段加权 + Legacy 词面作为必选通道；
- Dense 作为可选语义通道；
- 使用 RRF 融合，再做类型/子系统/标题/义务命中重排；
- Cross-Encoder `/rerank` 作为可选高精度重排；
- 所有外部模型失败都回退到 BM25F+Legacy。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| 纯词面 | 快、可解释、零成本 | 同义词漏召回 | 不足 |
| 纯向量 | 语义好 | 接口名/编号弱、需模型 | 不足 |
| 混合 + RRF | 互补、稳定 | 实现复杂 | 采用 |

## 后果

- 默认不产生 embedding/rerank 成本；
- Dense/Rerank 由环境变量启用；
- 需要 embedding/rerank 服务时可独立部署；
- 增加检索 smoke 测试和金标准指标需求。

## 验证

`pnpm retrieval:smoke`，并用地标集测 Recall@6/10。
