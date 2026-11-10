---
id: ADR-0003
title: 需求→设计采用义务级多设计联合覆盖
status: accepted
date: 2026-11-08
deciders:
  - architecture
  - QA
related_code:
  - server/src/evaluation/engine.ts
  - server/src/evaluation/obligations.ts
  - server/src/evaluation/summary.ts
supersedes: ""
---

# ADR-0003：需求→设计采用义务级多设计联合覆盖

## 背景

需求与设计不是一对一：一个需求可能需要多个设计共同实现；一个设计也可能支撑多条需求的不同部分。旧实现让 LLM 直接给整条需求 `satisfied/partial`，无法表达这种关系。

## 决策

- 需求义务编号为 `O1..On`；
- LLM 只输出每个设计覆盖了哪些义务（covered/partial/conflicting）；
- 代码按多个设计的并集计算：
  - 有冲突 → mismatch；
  - 所有义务完整覆盖 → satisfied；
  - 部分覆盖 → partial；
  - 无覆盖 → missing；
- 置信度按义务最强证据折扣后平均。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| LLM 直接给整条需求状态 | 简单、调用少 | 无法表达多设计、不可审计 | 不可接受 |
| 一对一匹配 | 易实现 | 与真实工程不符 | 不正确 |
| 义务级矩阵 | 可解释、支持多对多 | 输出更大、聚合复杂 | 采用 |

## 后果

- 关系保存 `targetCoverages/obligations/coverageRatio`；
- UI 显示每条义务覆盖和设计贡献；
- LLM 输出变大，需要严格校验；
- 旧评价任务没有矩阵，需要重跑才能获得新口径。

## 验证

覆盖矩阵单元测试：单设计全覆盖、多设计联合、部分、冲突、缺失、非法 ID。
