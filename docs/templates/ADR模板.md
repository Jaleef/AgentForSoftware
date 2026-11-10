---
id: DOC-TPL-002
title: ADR 模板
status: approved
owner: architecture
reviewers:
  - tech-lead
last_reviewed: 2026-11-08
related_code: []
---

# ADR 模板

ADR 只记录**重要且难以逆转**的决策；小改动写进 CHANGELOG 或文档正文即可。

```markdown
---
id: ADR-000X
title: 决策标题
status: accepted
date: 2026-11-08
deciders:
  - architecture
  - tech-lead
related_code: []
supersedes: ""
---

# ADR-000X：决策标题

## 背景

为什么现在必须做这个决策？有哪些约束？

## 决策

我们选择什么方案？一句话说清。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| A | | | |
| B | | | |

## 后果

### 正面

- ...

### 负面/代价

- ...

### 后续约束

- ...

## 验证

如何验证这个决策有效？指标、实验、人工评审。

## 关联

- 代码：
- 文档：
- 相关 ADR：
```

## 状态

- `proposed`：提议中；
- `accepted`：已采纳；
- `rejected`：已拒绝；
- `superseded`：被新 ADR 替代；
- `deprecated`：不再适用。

历史 ADR 不修改决策内容；需要变更时新增 ADR，并在旧 ADR 标注 `superseded by ADR-000Y`。
