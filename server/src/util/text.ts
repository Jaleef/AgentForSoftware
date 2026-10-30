/**
 * 文本清洗、分词和相似度工具。
 *
 * 提供中文 bigram、领域词/跨语言别名、Jaccard/覆盖度、关键词和 JSON 解析。
 */

const CJK = /[\u4e00-\u9fa5]/;

const STOP_CHARS = new Set("的了和与及或在为是有对将把从到等以及其该这那本项个系统功能需求应可需中上下时进行实现".split(""));

export function cleanText(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function firstSentences(text: string, maxChars = 260): string {
  const cleaned = cleanText(text);
  if (cleaned.length <= maxChars) return cleaned;
  const cut = cleaned.slice(0, maxChars);
  const idx = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("；"), cut.lastIndexOf("."));
  return idx > maxChars * 0.4 ? cut.slice(0, idx + 1) : `${cut}…`;
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[（(][^）)]{0,20}[）)]/g, " ")
    .replace(/[，。；、：:,.!?！？"'“”‘’()（）\[\]【】<>《》\-_/\\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cross-language aliases so Chinese design vocabulary can meet English identifiers. */
const TRANSLATIONS: Array<[string, string[]]> = [
  ["登录", ["login", "auth"]],
  ["退出", ["logout"]],
  ["用户", ["user", "users"]],
  ["权限", ["permission", "role"]],
  ["角色", ["role"]],
  ["身份验证", ["auth", "authenticate", "verify"]],
  ["身份", ["identity"]],
  ["模型", ["model", "models"]],
  ["几何", ["geometry", "geometric"]],
  ["数据", ["data"]],
  ["数据库", ["database", "db"]],
  ["同步", ["sync", "synchronize"]],
  ["导出", ["export"]],
  ["导入", ["import"]],
  ["传输", ["transfer"]],
  ["查询", ["query"]],
  ["检索", ["search"]],
  ["搜索", ["search"]],
  ["故障", ["fault", "faults"]],
  ["检测", ["detect", "detection"]],
  ["诊断", ["diagnose", "diagnosis"]],
  ["预测", ["predict", "prediction"]],
  ["寿命", ["life", "lifetime"]],
  ["健康", ["health"]],
  ["管理", ["manage", "management", "admin"]],
  ["展示", ["display", "show"]],
  ["页面", ["page"]],
  ["界面", ["page", "ui"]],
  ["日志", ["log", "logs"]],
  ["备份", ["backup"]],
  ["恢复", ["restore"]],
  ["状态", ["state", "status"]],
  ["监测", ["monitor"]],
  ["运维", ["maintenance"]],
  ["配置", ["config", "configuration"]],
  ["统计", ["statistics", "stat"]],
  ["分析", ["analysis", "analyze"]],
  ["上传", ["upload"]],
  ["下载", ["download"]],
  ["版本", ["version"]],
  ["回滚", ["rollback"]],
  ["新建", ["create", "insert", "add"]],
  ["创建", ["create"]],
  ["编辑", ["update", "edit"]],
  ["更新", ["update"]],
  ["删除", ["delete", "remove"]],
  ["列表", ["list"]],
  ["加密", ["encrypt"]],
  ["记录", ["record"]],
  ["告警", ["alarm", "alert"]],
  ["可视化", ["visualize", "render"]],
  ["实时", ["realtime"]],
  ["历史", ["history"]],
  ["温度", ["temperature"]],
  ["湿度", ["humidity"]],
  ["气压", ["pressure"]],
  ["风速", ["wind"]],
  ["降水", ["precipitation", "rain"]],
  ["测云", ["cloud"]],
  ["重力波", ["gravity"]],
  ["平台", ["platform"]],
  ["系统", ["system"]],
  ["服务", ["service"]],
  ["接口", ["api", "interface"]],
  ["文件", ["file"]],
  ["图片", ["image"]],
  ["数据驾驶舱", ["dashboard"]],
  ["仪表盘", ["dashboard"]],
  ["个人中心", ["profile"]],
  ["元数据", ["metadata"]],
  ["分析结果", ["result"]],
  ["数据管理", ["data", "manage"]],
  ["数据同步", ["sync", "data"]],
  ["模型管理", ["model", "manage"]],
  ["用户管理", ["user", "manage"]],
  ["数据库管理", ["database", "manage"]],
  ["故障检测", ["fault", "detect"]],
  ["故障诊断", ["fault", "diagnose"]],
  ["故障预测", ["fault", "predict"]],
  ["寿命预测", ["life", "predict"]],
  ["健康管理", ["health", "manage"]],
  ["状态监测", ["status", "monitor"]],
  ["远程运维", ["remote", "maintenance"]],
  ["数据查询", ["data", "query"]],
  ["数据存储", ["data", "store"]],
  ["数据通信", ["data", "communication"]],
  ["数据清洗", ["data", "clean"]],
  ["数据分类", ["data", "classify"]],
  ["数据融合", ["data", "fuse"]],
];

function addAsciiVariants(word: string, tokens: string[]): void {
  const lower = word.toLowerCase();
  if (lower.length >= 2) tokens.push(lower);
  const parts = word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$.\-/:]+/g, " ")
    .split(/\s+/);
  for (const part of parts) {
    const p = part.toLowerCase();
    if (p.length >= 2 && p !== lower) tokens.push(p);
  }
}

/** Mixed Chinese/ASCII tokenizer: ASCII identifiers + Chinese bi-grams + cross-language aliases. */
export function tokenize(text: string): string[] {
  const norm = normalizeForMatch(text);
  const tokens: string[] = [];
  const ascii = text.match(/[A-Za-z][A-Za-z0-9_$.\-/:]{1,}/g) ?? [];
  for (const word of ascii) addAsciiVariants(word, tokens);

  const cjkRuns = norm.match(/[\u4e00-\u9fa5]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!STOP_CHARS.has(bigram[0]) && !STOP_CHARS.has(bigram[1])) tokens.push(bigram);
    }
    for (const word of DOMAIN_WORDS) {
      if (run.includes(word)) {
        tokens.push(`#${word}`);
        const aliases = TRANSLATIONS.find(([term]) => term === word)?.[1];
        if (aliases) for (const alias of aliases) tokens.push(alias);
      }
    }
    for (const [term, aliases] of TRANSLATIONS) {
      if (!DOMAIN_WORDS.includes(term) && run.includes(term)) {
        for (const alias of aliases) tokens.push(alias);
      }
    }
  }
  return tokens;
}

const DOMAIN_WORDS = [
  "登录",
  "用户",
  "权限",
  "模型",
  "数据库",
  "数据同步",
  "数据导出",
  "数据导入",
  "数据传输",
  "查询",
  "故障检测",
  "故障诊断",
  "故障预测",
  "寿命预测",
  "健康管理",
  "状态监测",
  "几何模型",
  "远程运维",
  "数据管理",
  "日志",
  "元数据",
  "接口",
  "页面",
  "登录日志",
  "模型更新",
  "模型检索",
  "模型导出",
  "版本",
  "备份",
  "告警",
  "可视化",
  "时序",
  "虚实同步",
  "事件同步",
  "数据清洗",
  "数据分类",
  "统计分析",
  "参数配置",
  "角色",
  "审计",
  "部署",
  "性能",
  "并发",
  "响应时间",
  "加密",
  "安全",
  "可靠",
];

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Weighted overlap that favours rare, specific terms. */
export function overlapScore(query: Set<string>, target: Set<string>): number {
  if (query.size === 0 || target.size === 0) return 0;
  let hit = 0;
  let weight = 0;
  for (const t of query) {
    const w = t.startsWith("#") ? 3 : t.length >= 4 ? 1.5 : 1;
    weight += w;
    if (target.has(t)) hit += w;
  }
  return weight === 0 ? 0 : hit / weight;
}

export function similarity(a: string, b: string): number {
  return jaccard(tokenSet(a), tokenSet(b));
}

/**
 * 从文本中提取高频关键词。
 *
 * 过滤停用词和过短 token，按出现次数排序。
 */
export function extractKeywords(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (token.startsWith("#")) continue;
    if (token.length < 2 && !CJK.test(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)
    .slice(0, limit)
    .map(([t]) => t);
}

export function splitSentences(text: string): string[] {
  return cleanText(text)
    .split(/(?<=[。；;!?！？])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

export function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

export function safeJsonParse<T>(input: string): T | undefined {
  try {
    return JSON.parse(input) as T;
  } catch {
    // Models occasionally wrap JSON in prose or code fences. Try object and array slices.
    const candidates: Array<[number, number]> = [];
    const objectStart = input.indexOf("{");
    const objectEnd = input.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) candidates.push([objectStart, objectEnd + 1]);
    const arrayStart = input.indexOf("[");
    const arrayEnd = input.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push([arrayStart, arrayEnd + 1]);
    candidates.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    for (const [start, end] of candidates) {
      try {
        return JSON.parse(input.slice(start, end)) as T;
      } catch {
        /* try next */
      }
    }
    return undefined;
  }
}
