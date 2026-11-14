---
id: DOC-ARCH-001
title: 架构说明
status: approved
owner: architecture
reviewers:
  - backend
last_reviewed: 2026-11-08
related_code:
  - server/src
  - web/src
---

# 架构说明

## 1. 总体数据流

```
DOCX ──► ZIP/OOXML 解析 ──► 块序列（段落/表格）
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              需求点抽取            设计点抽取
        （表格规则点+文本候选） （设计表规则点+数据库/文本候选）
                    │                   │
                    ▼                   ▼
              需求单元/义务         设计单元/义务
                    └─────────┬─────────┘
                              ▼
                     StoredDocument（JSON）
                              │
代码目录 ──► 静态扫描 ──► CodeSnapshot（文件+符号+路由+模型）
                              │
                              ▼
                    评价 Runner（两层级）
              ┌───────────────┴───────────────┐
              ▼                               ▼
   混合检索 → LLM 义务覆盖矩阵          代码检索 → LLM 判定
   BM25F/Dense/RRF/Rerank              符号/路由/字段证据
              └───────────────┬───────────────┘
                              ▼
             Relation[] + 义务覆盖 + CampaignSummary
                              │
                              ▼
                评价页 / 报告页 / Markdown·CSV·JSON
```

## 2. 后端模块

| 路径 | 职责 |
| --- | --- |
| `src/parsers/zip.ts` | fflate 适配层：解压 DOCX OOXML entry |
| `src/parsers/xml.ts` | fast-xml-parser 适配层：保持顺序并转换为 XmlNode |
| `src/parsers/docx.ts` | OOXML 正文遍历：段落样式、标题层级、表格、合并单元格、分页标记、页码/行号估算 |
| `src/parsers/requirements.ts` | 需求点抽取（表格规则点 + 文本候选点）、规则回退单元、稳定编号 |
| `src/parsers/design.ts` | 设计点抽取（设计表规则点、数据库/文本候选点）、规则回退单元、字段与接口义务 |
| `src/parsers/code.ts` | 代码目录遍历、多语言符号/路由/模型抽取、代码树构建 |
| `src/llm/requirements.ts` | 文本需求点判定、LLM 生成需求单元 |
| `src/llm/design.ts` | 文本/数据库设计点判定、LLM 生成设计单元 |
| `src/llm/taxonomy.ts` | auto：章节路径优先，质量差时 LLM 语义归纳 |
| `src/evaluation/retrieval.ts` | Legacy 词面检索、设计/代码索引、类型亲和度 |
| `src/evaluation/obligations.ts` | 需求义务稳定编号（O1..On） |
| `src/evaluation/embeddings.ts` | 可选 OpenAI 兼容 embedding、缓存与归一化 |
| `src/evaluation/hybrid.ts` | 义务级 BM25F/Dense/Legacy 召回、RRF 融合与结构重排 |
| `src/evaluation/rerank.ts` | 可选 Cross-Encoder `/rerank` 重排 |
| `src/evaluation/engine.ts` | 批量 LLM 判定、结果校验、启发式回退、进度与取消 |
| `src/evaluation/summary.ts` | 覆盖率、得分、分子系统/类型分桶、P0/P1/P2 |
| `src/evaluation/runner.ts` | 任务生命周期、LLM 预检、持久化进度、取消、重启恢复 |
| `src/llm/client.ts` | openai SDK 适配层：Chat Completions、JSON/重试/usage/连接测试 |
| `src/services/documents.ts` | 上传落盘、解析、统计、重新拆分、后台 LLM 整理 |
| `src/services/requirements.ts` | 手工新增/删除需求单元、`SRS-MAN-NNN` 编号、同步需求点 |
| `src/services/design.ts` | 手工新增/删除设计单元、`SDD-MAN-NNN` 编号、同步设计点 |
| `src/services/projects.ts` | 项目聚合视图 |
| `src/services/report.ts` | Markdown/CSV 报告生成 |
| `src/store.ts` | SQLite 存储门面、缓存、行级 diff、设置脱敏 |
| `src/storage/db.ts` | `node:sqlite` 连接、WAL pragma、事务 |
| `src/storage/schema.ts` | 顶层实体表、索引、schema 版本 |
| `src/storage/migrate.ts` | `store.json` / `settings.json` 一次性迁移与备份 |

## 3. DOCX 解析细节

### 3.1 ZIP 与 XML

DOCX 本质是 ZIP。后端直接解析中央目录与本地文件头，使用 Node `zlib.inflateRawSync` 解压，不依赖第三方库。

XML 解析器支持命名空间前缀、属性、CDATA、注释、字符实体与自闭合标签；段落与表格保留在正文中的顺序。

### 3.2 合并单元格

需求表常见的 4×4 结构依赖横向合并（`gridSpan`）和纵向合并（`vMerge`）。解析器把每行展开为网格，并保留每个单元格的起始列与跨度：

- 标签单元格值在下一个单元格；
- 一行中出现两个标签（`需求ID … 父需求ID`）时按标签位置切分；
- 仅保留首个匹配，避免合并单元格重复文本。

### 3.3 页码与行号

- 优先使用 Word 保存的 `w:lastRenderedPageBreak`；表格内的分页标记也会累加。
- 没有分页标记时按每页 46 行、每行 42 个全角字符估算。
- 面板中标注“按渲染分页估算”，避免把估算值当成精确定位。

### 3.4 标题与章节

- 从 `styles.xml` 解析 styleId → name，支持 `Heading N`、`标题 N`、`outlineLvl`。
- 忽略 `toc N` 目录样式，避免把目录当成正文。
- 维护标题栈生成章节路径（如 `详细设计 / 数字孪生系统集成平台模块详细设计 / 管理模块设计 / 模型管理模块`）。
- **需求和设计解析都不使用章节名决定类型或子系统**；章节路径只作为追溯和 taxonomy 统计信息保存。

## 4. 抽取规则

### 4.1 需求

需求拆分为 **需求点 → 需求单元** 两阶段，不依赖示例文档的章节名称。

| 阶段 | 来源 | 规则 | 来源标记 / 置信度 |
| --- | --- | --- | --- |
| 需求点 | 需求表 | 含 `需求描述` 或 `需求名称`，且含 `需求说明`/`测试规程`/`需求ID`；一张表 = 一个需求点 | `origin=rule`，`confidence=1.0` |
| 需求点 | 纯文字叶子章节 | 叶节点章节中未被过滤的正文段落作为候选，例如 `3.5.2 外部系统接口`；由 LLM 判断是否为需求点 | `origin=llm`，置信度由 LLM 给出 |
| 子系统分类 | 全部已接受需求点的章节路径 | auto：先按章节深度分组；其他占比过高时用 LLM 归纳 | `SubsystemCategory[]`，类别名与章节列表 |
| 需求单元 | 全部已接受需求点 | LLM 生成标题、类型、摘要、原子义务、关键词；子系统取分类映射 | 继承需求点来源与置信度 |

- 文本候选的过滤只排除目录、图题、过短文本、纯标签等结构噪声，不按章节名判断。
- 每个需求点保存带编号的 `chapterPath`，例如 `3 需求分析 / 3.3 功能需求 / 3.3.1 ... / 3.3.1.1 ...`；full path 只用于追溯和分类统计。
- 需求表 ID 为空时，最终按 LLM 判断出的类型生成 `SRS-<TYPE>-NNN`；源文档 ID 保留在 `sourceId`。
- 子系统类别数量上限为 10（提示词要求 3–8），避免把具体功能名当作子系统。
- 没有 LLM 时，仅需求表需求点回退为 `其他需求` 单元；文本候选保留为未判定状态，等待「LLM 整理」。

### 4.2 设计

设计拆分与需求一致：先抽设计点，再由 LLM 生成设计单元；不使用章节名推断子系统。

| 阶段 | 来源 | 规则 | 来源标记 / 置信度 |
| --- | --- | --- | --- |
| 设计点 | 7×2 / 6×2 设计表 | 含 `模块编号`/`子功能编号` + 功能描述；一张表 = 一个设计点 | `origin=rule`，`confidence=1.0` |
| 设计点 | 数据库表 | 表头含 `字段名称` + `字段类型/字段含义`，字段结构保留为候选数据 | `origin=llm`，由 LLM 判定是否构成数据表设计单元 |
| 设计点 | 文本章节 | 叶子章节的正文/页面描述/UI 表格作为候选 | `origin=llm`，由 LLM 判定是否构成设计单元 |
| 子系统分类 | 已接受设计点的章节路径 | auto：先按章节深度分组；质量差时用 LLM 归纳 | `designSubsystemTaxonomy` |
| 设计单元 | 全部已接受设计点 | LLM 生成名称、类型、摘要、设计义务、关键词；结构化表保持类型/接口/输入输出 | 继承设计点来源与置信度 |

- 每个设计点保存带编号的 `chapterPath`，例如 `5 详细设计 / 5.1 平台模块详细设计 / 5.1.1 管理模块设计 / 5.1.1.4 数据库管理`。
- 数据表字段列表、接口签名、输入输出会保留到设计单元，参与代码检索和设计→代码评价。
- 数据库表/文本候选只有 LLM 判定通过后才成为设计单元；无 LLM 时仅保留结构化设计表单元。
- 子系统类别上限 10 个，避免把具体功能名当作子系统。

### 4.3 代码

- 排除目录：`node_modules`、`.git`、`dist`、`build`、`target`、`vendor`、`coverage`、`.venv` 等。
- 跳过 `.min.js`、`.map`、超过 400KB 的文件；总扫描上限 24MB / 5000 文件。
- 符号：class/interface/enum/function/method/component/route/model/table。
- 路由：Express/Fastify/NestJS、Flask/FastAPI、Spring。
- 模型：Prisma、SQL `CREATE TABLE`、TypeORM `@Entity`、Sequelize/Mongoose。
- 每个符号保存最多 520 字符上下文，供 LLM 判定证据使用。

## 5. 评价执行

评价由 `runEvaluation`（`server/src/evaluation/engine.ts`）直接编排：先按子系统过滤，再依次执行需求→设计、设计→代码两个层级，最后用 `computeSummary` 汇总。`runner.ts` 只负责任务生命周期、LLM 预检、进度持久化、取消和重启恢复。

具体步骤：

1. 校验层级所需文档（需求/设计/快照）。
2. 需求→设计：
   - `buildHybridRetriever` 构建 BM25F/Legacy 索引，按配置尝试 Dense；
   - 按需求义务逐条召回，RRF 融合，可选 Cross-Encoder；
   - 每条需求取 Top 8，评价引擎取 Top 6。
3. LLM 判定：
   - 需求 payload 带 `O1..On` 义务；
   - LLM 返回每个设计的 `targetCoverages`，不直接给整条需求状态；
   - 校验 designCode 和 obligationId。
4. 程序聚合：
   - `buildCoverageRelation` 按冲突 > 完整覆盖 > 部分覆盖 > 缺失合并义务；
   - 计算 `coverageRatio` 和覆盖置信度；
   - 支持多个设计联合覆盖一条需求。
5. 设计→代码：
   - `rankCodeCandidates` 取 Top 7（同文件最多 2）；
   - LLM 返回 `targetHandles`，校验后生成 Relation。
6. 汇总并持久化每批进度；支持取消（AbortController）与重启恢复。
7. LLM 预检失败时自动整体回退，避免连续失败拖慢任务。

检索细节见 [检索](检索.md)，状态/置信度见 [评价口径](EVALUATION.md)。

## 6. 存储

`data/app.db` 使用 Node 内置 `node:sqlite`，WAL 模式。顶层实体各占一行：

```text
projects(id, created_at, updated_at, payload)
documents(id, project_id, kind, uploaded_at, updated_at, payload)
snapshots(id, project_id, created_at, payload)
campaigns(id, project_id, status, created_at, updated_at, payload)
settings(id=1, payload, updated_at)
meta(key, value)
coverage_cache(cache_key, model, prompt_version, payload, created_at, last_used_at)
```

`payload` 保存完整对象 JSON，因此 `StoreData` 和所有 API 不变：

```ts
{
  version: 1,
  projects: Project[],
  documents: StoredDocument[],   // 含 requirements/designUnits、requirementPoints/designPoints、taxonomy、stats
  snapshots: CodeSnapshot[],
  campaigns: Campaign[]          // 含 relations / targetCoverages / summary / progress
}
```

- 读：首次访问从 SQLite 加载到内存缓存；
- 写：`mutateStore` 串行执行，事务内按实体 JSON diff 只 upsert 变化行、删除消失行；
- 失败：回滚并清空缓存，下次从数据库重新加载；
- 旧 `store.json` / `settings.json` 首次启动迁移后改名为 `*.migrated-*`；
- `data/uploads/<projectId>/...` 仍保存原始 DOCX。

### 6.1 LLM 配置来源

`server/src/config/env.ts` 负责读取配置：

- **开发环境**（`NODE_ENV=development` 或直接以 tsx 运行 `src/index.ts`）：加载仓库根目录 `.env`，`LLM_*` 覆盖 `data/app.db` 设置表的对应字段。
- **部署环境**（运行 `server/dist`）：不加载 `.env` 中的 LLM 配置，只读取「设置」页保存的 `data/app.db`。
- 开发环境只要检测到任一 `LLM_*`，`/api/settings` 返回 `meta.configSource="env"`，设置页只读；保存接口返回 409。
- 真实进程环境变量优先于 `.env` 文件值。
- API Key 只在服务端使用，接口响应仅返回脱敏提示。

## 7. 前端

- React 19 + React Router 7 + Vite。
- 无 UI 组件库；`components/ui.tsx` 提供 Card/Button/Tag/ScoreRing 等基础件，`styles.css` 定义完整设计系统。
- 数据获取：轻量 `useResource` Hook（loading/error/reload），评价任务运行中 1.5s 轮询 `statusOnly=1`。
- 页面使用两栏布局：左侧列表树，右侧 sticky 详情面板；移动端降级为单栏。
- 报告页支持打印样式，可直接“打印 / PDF”。

## 8. 扩展点

- **新增文档模板**：在 `requirements.ts` / `design.ts` 增加表格标签/字段别名；文本结构由 LLM 判定，不增加章节名分类规则。
- **新增代码语言**：在 `code.ts` 增加扩展名与符号正则；索引/评价无需改动。
- **新增评价维度**：在 `types.ts` 扩展 `Relation`，在 `engine.ts` 增加链路，在 `summary.ts` 增加权重。
- **接入其他模型**：`LlmClient` 已是通用 OpenAI 兼容层；如协议不同，替换 `chat()` 即可。
- **持久化升级**：`store.ts` 是唯一存储入口，可替换为 SQLite/PostgreSQL。



