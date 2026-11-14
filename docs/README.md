---
id: DOC-INDEX-001
title: 文档门户
status: approved
owner: tech-lead
reviewers:
  - architecture
last_reviewed: 2026-11-08
related_code: []
---

# 文档门户

本目录是项目文档的唯一入口。README 只保留运行契约；所有会随开发变化的内容都在这里维护。

## 1. 文档索引

| ID | 文档 | Owner | 状态 | 用途 |
| --- | --- | --- | --- | --- |
| DOC-GOV-001 | [文档管理规范](文档管理规范.md) | tech-lead | approved | 文档生命周期、角色、评审和归档规则 |
| DOC-PRD-001 | [产品需求与范围](产品需求与范围.md) | product | approved | 目标、用户、场景、非目标和验收标准 |
| DOC-UI-001 | [功能与界面](功能与界面.md) | frontend | approved | 页面能力、操作流程、截图 |
| DOC-FLOW-001 | [数据流](数据流.md) | backend | approved | 每类操作的调用链、落盘和失败回退 |
| DOC-ARCH-001 | [架构说明](ARCHITECTURE.md) | architecture | approved | 模块、解析器、存储、评价执行 |
| DOC-AGENT-001 | [Agent 架构](Agent架构.md) | architecture | approved | 主/子 Agent、契约、预算、审计 |
| DOC-DEPS-001 | [依赖与适配层](依赖与适配层.md) | architecture | approved | 成熟库、适配层、注释和替换边界 |
| DOC-EVAL-001 | [评价口径](EVALUATION.md) | architecture | approved | 状态、覆盖、置信度、评分、LLM 契约 |
| DOC-RET-001 | [检索](检索.md) | architecture | approved | BM25F、Dense、RRF、Rerank |
| DOC-API-001 | [API](API.md) | backend | approved | 前后端接口契约、请求/响应、错误码 |
| DOC-OPS-001 | [配置与运行](配置与运行.md) | ops | approved | 环境变量、部署、排障、开发命令 |
| DOC-QA-001 | [测试与验收](测试与验收.md) | QA | approved | 测试策略、验收标准、质量指标 |
| DOC-PLAN-001 | [限制与路线图](限制与路线图.md) | tech-lead | approved | 已知限制、非目标、后续计划 |
| DOC-CHG-001 | [变更记录](CHANGELOG.md) | tech-lead | approved | 版本和文档变更 |
| DOC-ADR-000 | [ADR 索引](adr/README.md) | architecture | approved | 关键架构决策 |
| DOC-TPL-001 | [文档模板](templates/文档模板.md) | tech-lead | approved | 新文档模板 |
| DOC-TPL-002 | [ADR 模板](templates/ADR模板.md) | architecture | approved | 新 ADR 模板 |
| DOC-TPL-003 | [评审清单](templates/评审清单.md) | tech-lead | approved | 文档评审检查项 |

## 2. 阅读路径

| 角色 | 建议顺序 |
| --- | --- |
| 新用户 | README → 功能与界面 → 配置与运行 |
| 开发者 | 架构说明 → Agent 架构 → 数据流 → API → 测试与验收 |
| 评审者 | 评价口径 → 检索 → 测试与验收 |
| 运维者 | 配置与运行 → 限制与路线图 → 数据流 |
| 架构评审 | 架构说明 → Agent 架构 → ADR → 数据流 |

## 3. 单一来源规则

| 内容 | 只写在这里 |
| --- | --- |
| 安装、启动、端口、数据目录、配置来源、文档入口 | `README.md` |
| 页面功能、截图、用户操作 | `功能与界面.md` |
| 操作调用链、持久化、状态和回退 | `数据流.md` |
| 模块职责、解析器、存储结构 | `ARCHITECTURE.md` |
| 状态、覆盖率、置信度、评分、LLM 契约 | `EVALUATION.md` |
| 检索算法和模型配置 | `检索.md` |
| 路由、请求/响应 | `API.md` |
| 环境变量、部署、排障、开发命令 | `配置与运行.md` |
| 测试策略、验收标准 | `测试与验收.md` |
| 示例数据、演示流程 | `功能与界面.md` |
| 限制、非目标、路线图 | `限制与路线图.md` |
| 关键决策及理由 | `adr/` |
| 版本变更 | `CHANGELOG.md` |

不要在多个文档复制同一张表；需要时用相对链接指向唯一来源。

## 4. 更新规则

1. **功能变化**：更新 `功能与界面.md` 和 `数据流.md`；涉及接口时更新 `API.md`。
2. **架构/算法变化**：更新 `ARCHITECTURE.md`、`EVALUATION.md` 或 `检索.md`；关键取舍新增 ADR。
3. **配置/部署变化**：更新 `配置与运行.md`；README 只在运行契约变化时更新。
4. **版本发布**：更新 `CHANGELOG.md`，检查文档元数据 `last_reviewed`。
5. **文档废弃**：状态改为 `deprecated`，在索引中标注替代文档；确需保留历史时再创建归档目录。

## 5. 文档评审

所有正式文档至少经过一名非作者 review。评审使用 [评审清单](templates/评审清单.md)。

- 架构、评价口径、检索、安全相关文档必须有第二人 review；
- 功能/UI 文档可由前端 owner 自审 + 后端确认接口；
- 发布前检查一次链接、示例数字和过期接口；
- 每季度由 owner 检查一次 `last_reviewed` 和内容准确性。

## 6. 元数据

正式文档使用 YAML frontmatter：

```yaml
---
id: DOC-XXX-001
title: 文档标题
status: approved
owner: role-or-person
reviewers: []
last_reviewed: 2026-11-08
related_code: []
---
```

`status` 取值：`draft`、`in-review`、`approved`、`deprecated`。

README 和 CHANGELOG 不要求 frontmatter。
