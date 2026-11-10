---
id: ADR-0002
title: 需求/设计采用两阶段拆分
status: accepted
date: 2026-11-08
deciders:
  - architecture
  - product
related_code:
  - server/src/parsers/requirements.ts
  - server/src/parsers/design.ts
  - server/src/llm/requirements.ts
  - server/src/llm/design.ts
supersedes: ""
---

# ADR-0002：需求/设计采用“点 → LLM 单元”两阶段拆分

## 背景

早期实现按章节名推断需求类型/子系统，切换到另一份文档就失效；表格和文本混在一起直接分类也不稳定。

## 决策

1. 先抽“点”：
   - 结构化表格直接成为规则点；
   - 文本/数据库候选由 LLM 判定。
2. 再把所有已接受点交给 LLM 生成单元：
   - 标题、类型、摘要、义务、关键词；
   - 子系统由统一 taxonomy 映射，不由章节名直接决定。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| 按章节名规则分类 | 快、无 LLM | 文档一变就失效 | 不可泛化 |
| 每个段落直接 LLM 分类 | 简单 | 成本高、重复、无表格结构 | 不可控 |
| 两阶段拆分 | 结构可信、文本灵活 | 多一次 LLM 调用 | 采用 |

## 后果

- 表格单元置信度 100%；
- 文本单元置信度来自 LLM 判定；
- 需要保存 `requirementPoints/designPoints` 以支持重跑；
- 人工单元需要在重跑时保留；
- 依赖章节路径做 taxonomy，而不是类型分类。

## 验证

示例文档规则点数量、文本候选、单元生成和手工单元保留测试。
