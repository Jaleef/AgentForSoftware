# 变更记录

## 2026-11-10

### 存储

- 主存储从 `data/store.json` 迁移到 `data/app.db`（Node 内置 `node:sqlite`，WAL）；
- 新增一次性 JSON 迁移、`*.migrated-*` 备份和 `pnpm store:smoke`；
- 设置从 `data/settings.json` 迁移到 SQLite `settings` 表；
- 最低 Node 版本提升到 24；
- 新增 ADR-0007，ADR-0005 标记为 superseded。

## 2026-11-08

### 文档体系

- README 重构为稳定运行入口；
- 新增 docs 门户、文档管理规范、模板、评审清单和归档规则；
- 新增产品需求、功能与界面、数据流、API、配置与运行、测试与验收、限制与路线图；示例数据和追溯矩阵后续分别并入功能文档、架构文档；
- 新增 ADR-0001～ADR-0005；
- 修正 ARCHITECTURE/EVALUATION/检索 中与当前实现不一致的内容。

### 性能

- 拆分阶段不再把 `LLM_CONCURRENCY` 硬限制为 3，当前最高支持 8；
- taxonomy 的章节 assignment 请求改为最多 3 批并行；
- `.env.example` 推荐并发调整为 6。

### 修复

- 修复 LLM 直接返回裸类别数组时子系统分类被丢弃的问题；
- 类别存在但缺少章节映射时，增加分批 assignment 请求，避免大 JSON 截断；
- 重新拆分改为只做规则解析，不再自动触发 LLM。

### 文档清理

- 示例数据合并进 `功能与界面.md`，删除独立 `示例数据.md`；
- 追溯矩阵内容由 `ARCHITECTURE.md` 模块表和 `docs/README.md` 索引覆盖，删除 `追溯矩阵.md`；
- 当前没有归档文档，删除空的 `99-归档/` 目录。

### Agent 架构

- 新增确定性 MainAgent 和需求/设计拆分、需求→设计、设计→代码子 Agent；
- 新增 AgentRun 审计、LLM 调用预算和 `agents:smoke`；
- 评价 runner 切换到主 Agent 管线，旧 `runEvaluation` 保留兼容。

### 系统能力（同步记录）

- 需求→设计评价采用义务级多设计联合覆盖；
- 检索采用义务级 BM25F + Legacy + RRF，可选 Dense 和 Cross-Encoder；
- 需求/设计单元支持手工新增/删除并在 LLM 重跑后保留；
- 评价详情支持设计单元左侧悬浮对比。

## 版本说明

当前仓库尚未建立正式语义化版本标签。后续发布时：

```text
## vX.Y.Z - YYYY-MM-DD
### Added
### Changed
### Fixed
### Docs
```

