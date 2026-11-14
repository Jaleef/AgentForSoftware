# 变更记录

## 2026-11-10

### 去自研化

- ZIP 改用 `fflate`，XML 改用 `fast-xml-parser`；
- LLM 客户端改用 `openai` SDK；
- BM25 改用 `minisearch`；
- `.env` 解析改用 `dotenv`；
- 前端资源请求改用 `@tanstack/react-query`；
- 新增 `vitest` 解析回归测试、`knip` 死代码扫描；
- 删除未使用的 AgentRegistry、TaxonomyAgent 和若干死导出。

### 接口文档

- `docs/API.md` 从路由摘要扩展为前后端接口契约：请求/响应、异步轮询、错误码、`profile/usage`、手工单元、快照、设置和前端 `api.ts` 映射。

### Embedding / Rerank 修复

- `hybrid-smoke` 现在显式加载 `.env`，避免 smoke 误报 `denseEnabled=false`；
- Embedding 批次超过服务上限（如阿里云 25 条）时自动二分重试；
- Rerank 自动识别阿里云 MaaS `/compatible-api/v1/reranks`，支持 `RERANK_PATH`；
- 修复后实测 Dense 与 Rerank 均启用，warnings 为空。

### 子系统分类修复

- 默认改为 `LLM_TAXONOMY=auto`：章节路径优先，其他占比超过 25% 时自动用 LLM 语义归纳；
- 修复混合章节结构下“其他 53 条”、类别名只是“用例描述/功能需求”的问题；
- taxonomy assignment 批次从 40 降到 20，避免 JSON 截断；
- 仍保留纯 heuristic 和强制 LLM 两种模式。

### LLM 整理提速

- 默认子系统分类改为章节路径启发式，0 次 taxonomy LLM 调用；
- 保留 `LLM_TAXONOMY=llm` 作为可选高质量模式；
- 修正启发式分类不再误报“未成功生成子系统分类”；
- 示例需求整理调用数从约 46 降至约 34。

### 评价成本优化

- 需求→设计候选改为每批去重共享 `designs + candidateCodes`；
- 新增 economy / balanced / quality 模式；
- 紧凑候选字段，经济模式每批 6 条需求、Top 4 + 3072 输出上限；
- 新增 `Campaign.usage`，记录输入/输出 token 和 LLM 调用数；
- 新增 SQLite `coverage_cache`，相同 payload 的批次可直接复用；
- 当前数据实测 payload：quality 约 833k → economy 约 495k 字符（约 -41%），批次数 42 → 28。

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

