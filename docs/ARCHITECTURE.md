# 架构说明

## 1. 总体数据流

```
DOCX ──► ZIP/OOXML 解析 ──► 块序列（段落/表格）
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              需求抽取器            设计抽取器
        （表格+章节段落）      （设计表+数据表+页面）
                    │                   │
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
     需求→设计检索 + LLM 判定          设计→代码检索 + LLM 判定
              └───────────────┬───────────────┘
                              ▼
                  Relation[] + CampaignSummary
                              │
                              ▼
                评价页 / 报告页 / Markdown·CSV·JSON
```

## 2. 后端模块

| 路径 | 职责 |
| --- | --- |
| `src/parsers/zip.ts` | 最小 ZIP 读取器（stored/deflate），读取 `word/document.xml`、`styles.xml`、`docProps` |
| `src/parsers/xml.ts` | 容错 XML DOM 解析器，保留元素顺序与属性 |
| `src/parsers/docx.ts` | OOXML 正文遍历：段落样式、标题层级、表格、合并单元格、分页标记、页码/行号估算 |
| `src/parsers/requirements.ts` | 需求点抽取（表格规则点 + 文本候选点）、规则回退单元、稳定编号 |
| `src/parsers/design.ts` | 设计表、数据库表、页面章节抽取；字段与接口义务 |
| `src/parsers/code.ts` | 代码目录遍历、多语言符号/路由/模型抽取、代码树构建 |
| `src/llm/requirements.ts` | 文本需求点判定、LLM 生成需求单元（类型/子系统/义务/摘要） |
| `src/evaluation/retrieval.ts` | 中英文混合分词、类型亲和度、候选设计与代码排序 |
| `src/evaluation/engine.ts` | 批量 LLM 判定、结果校验、启发式回退、进度与取消 |
| `src/evaluation/summary.ts` | 覆盖率、得分、分子系统/类型分桶、P0/P1/P2 |
| `src/evaluation/runner.ts` | 任务生命周期、LLM 预检、持久化进度、取消、重启恢复 |
| `src/llm/client.ts` | OpenAI 兼容 Chat Completions、JSON 解析、重试、并发控制、连接测试 |
| `src/llm/enrich.ts` | 需求/设计摘要、原子义务、关键词、类型分类 |
| `src/services/documents.ts` | 上传落盘、解析、统计、重新拆分、后台 LLM 整理 |
| `src/services/requirements.ts` | 手工新增/删除需求单元、`SRS-MAN-NNN` 编号、同步需求点 |
| `src/services/projects.ts` | 项目聚合视图 |
| `src/services/report.ts` | Markdown/CSV 报告生成 |
| `src/store.ts` | JSON 文件存储、串行化写入、原子替换、设置脱敏 |

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
- 设计解析仍可从标题回溯子系统；**需求解析不使用章节名决定需求类型或子系统**，章节路径只作为追溯信息保存。

## 4. 抽取规则

### 4.1 需求

需求拆分为 **需求点 → 需求单元** 两阶段，不依赖示例文档的章节名称。

| 阶段 | 来源 | 规则 | 来源标记 / 置信度 |
| --- | --- | --- | --- |
| 需求点 | 需求表 | 含 `需求描述` 或 `需求名称`，且含 `需求说明`/`测试规程`/`需求ID`；一张表 = 一个需求点 | `origin=rule`，`confidence=1.0` |
| 需求点 | 纯文字叶子章节 | 叶节点章节中未被过滤的正文段落作为候选，例如 `3.5.2 外部系统接口`；由 LLM 判断是否为需求点 | `origin=llm`，置信度由 LLM 给出 |
| 子系统分类 | 全部已接受需求点的章节路径 | LLM 把章节路径归纳为 3–8 个概括类别，并输出“章节路径 → 类别”映射 | `SubsystemCategory[]`，类别名与章节列表 |
| 需求单元 | 全部已接受需求点 | LLM 生成标题、类型、摘要、原子义务、关键词；子系统取分类映射 | 继承需求点来源与置信度 |

- 文本候选的过滤只排除目录、图题、过短文本、纯标签等结构噪声，不按章节名判断。
- 每个需求点保存带编号的 `chapterPath`，例如 `3 需求分析 / 3.3 功能需求 / 3.3.1 ... / 3.3.1.1 ...`；full path 只用于追溯和分类统计。
- 需求表 ID 为空时，最终按 LLM 判断出的类型生成 `SRS-<TYPE>-NNN`；源文档 ID 保留在 `sourceId`。
- 子系统类别数量上限为 10（提示词要求 3–8），避免把具体功能名当作子系统。
- 没有 LLM 时，仅需求表需求点回退为 `其他需求` 单元；文本候选保留为未判定状态，等待「LLM 整理」。

### 4.2 设计

| 来源 | 识别 | 编号 |
| --- | --- | --- |
| 7×2 / 6×2 设计表 | 含 `模块编号`/`子功能编号` + 功能描述 | `SDD-FUN-NNN` 或 `SDD-MOD-NNN` |
| 数据库表 | 表头含 `字段名称` + `字段类型/字段含义` | `SDD-DB-NNN` |
| 页面章节 | 位于 H1「页面设计」下的 H3–H5 标题 | `SDD-PAGE-NNN` |

- 表格前一行的“登录信息表”作为数据表名称。
- 接口签名、输入输出、字段列表都会写入设计义务/关键词，参与代码检索。
- 页面标题去掉“设计”后缀；过滤“分级图/跳转图/接口”等非页面章节。

### 4.3 代码

- 排除目录：`node_modules`、`.git`、`dist`、`build`、`target`、`vendor`、`coverage`、`.venv` 等。
- 跳过 `.min.js`、`.map`、超过 400KB 的文件；总扫描上限 24MB / 5000 文件。
- 符号：class/interface/enum/function/method/component/route/model/table。
- 路由：Express/Fastify/NestJS、Flask/FastAPI、Spring。
- 模型：Prisma、SQL `CREATE TABLE`、TypeORM `@Entity`、Sequelize/Mongoose。
- 每个符号保存最多 520 字符上下文，供 LLM 判定证据使用。

## 5. 评价执行

1. 校验层级所需文档（需求/设计/快照）。
2. 构建设计索引（名称、描述、义务、接口、字段、关键词）与代码符号索引。
3. 对每个需求/设计单元计算候选分数：
   - 中文 bigram + 领域词；
   - 中文→英文别名（登录→login、模型→model、故障检测→fault/detect 等）；
   - 驼峰/下划线/路径拆分（`updateModel`→`update`,`model`）；
   - 设计接口标识符与代码符号名的强匹配；
   - 类型亲和度（需求类型 ↔ 设计类型、设计类型 ↔ 符号类型）；
   - 同子系统加权。
4. 以 4 条需求/批、3 个设计/批调用 LLM，要求返回严格 JSON。
5. 校验返回的 code/handle 必须来自候选集合；无法匹配时回退启发式。
6. 汇总并持久化每批进度；支持取消（AbortController）与重启恢复。
7. LLM 预检失败时自动整体回退，避免连续失败拖慢任务。

## 6. 存储

`data/store.json`：

```ts
{
  version: 1,
  projects: Project[],
  documents: StoredDocument[],   // 含 requirements / designUnits / outline / stats
  snapshots: CodeSnapshot[],     // 每个项目保留最近 3 个
  campaigns: Campaign[]          // 含 relations / summary / progress
}
```

`data/settings.json`：LLM 配置（含 API Key 明文，仅本机）。
`data/uploads/<projectId>/...`：原始 DOCX。

写操作通过串行队列执行，先写临时文件再 `rename`，避免并发写坏文件。读取使用内存缓存。

### 6.1 LLM 配置来源

`server/src/config/env.ts` 负责读取配置：

- **开发环境**（`NODE_ENV=development` 或直接以 tsx 运行 `src/index.ts`）：加载仓库根目录 `.env`，`LLM_*` 覆盖 `data/settings.json` 的对应字段。
- **部署环境**（运行 `server/dist`）：不加载 `.env` 中的 LLM 配置，只读取「设置」页保存的 `data/settings.json`。
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

- **新增文档模板**：在 `requirements.ts` / `design.ts` 增加表格标签与章节分类规则。
- **新增代码语言**：在 `code.ts` 增加扩展名与符号正则；索引/评价无需改动。
- **新增评价维度**：在 `types.ts` 扩展 `Relation`，在 `engine.ts` 增加链路，在 `summary.ts` 增加权重。
- **接入其他模型**：`LlmClient` 已是通用 OpenAI 兼容层；如协议不同，替换 `chat()` 即可。
- **持久化升级**：`store.ts` 是唯一存储入口，可替换为 SQLite/PostgreSQL。
