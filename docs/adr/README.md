---
id: DOC-ADR-000
title: ADR 索引
status: approved
owner: architecture
reviewers:
  - tech-lead
last_reviewed: 2026-11-08
related_code: []
---

# ADR 索引

架构决策记录（Architecture Decision Record）只记录重要、难以逆转的决策。历史 ADR 不修改，需要变更时新增 ADR 并标注替代关系。

| ADR | 决策 | 状态 |
| --- | --- | --- |
| [ADR-0001](ADR-0001-docx-parser.md) | DOCX 使用自研 ZIP/OOXML 解析 | accepted |
| [ADR-0002](ADR-0002-two-stage-split.md) | 需求/设计采用“点 → LLM 单元”两阶段拆分 | accepted |
| [ADR-0003](ADR-0003-obligation-coverage.md) | 需求→设计采用义务级多设计联合覆盖 | accepted |
| [ADR-0004](ADR-0004-hybrid-retrieval.md) | 检索采用 BM25F + Dense + RRF + 可选 Rerank | accepted |
| [ADR-0005](ADR-0005-json-storage.md) | 当前采用单用户 JSON 存储 | accepted |
| [ADR-0006](ADR-0006-main-sub-agent.md) | 确定性主 Agent + 专用子 Agent | accepted |

新 ADR 复制 [ADR 模板](../templates/ADR模板.md)。
