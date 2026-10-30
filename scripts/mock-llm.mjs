import http from "node:http";

const port = Number(process.env.MOCK_LLM_PORT ?? 8899);
let calls = 0;

function extractJson(text) {
  const starts = [text.indexOf("["), text.indexOf("{")].filter((i) => i >= 0);
  if (!starts.length) return undefined;
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function handleTextJudgement(payload) {
  const items = Array.isArray(payload) ? payload : [];
  return {
    items: items.map((entry) => {
      const chapter = String(entry.chapter ?? "");
      const text = String(entry.text ?? "");
      const background = /文档概述|范围|引用文档|用例描述|术语|目录|修订|读者/.test(chapter);
      const looksLikeRequirement = /系统|应|需|支持|提供|实现|具备|接口|数据|安全|性能|记录|管理|精度|时间|约束|交付|监测|预测|检测/.test(text);
      const accepted = !background && looksLikeRequirement && text.length >= 10;
      return {
        pointId: entry.pointId,
        isRequirement: accepted,
        confidence: accepted ? 0.86 : 0.72,
        reason: accepted ? "mock: 文本描述了可验证的系统要求。" : "mock: 背景介绍/说明性文字，不构成独立需求点。",
      };
    }),
  };
}

function guessRequirementType(text) {
  if (/安全|权限|加密|身份|保密|审计/.test(text)) return "安全保密需求";
  if (/性能|响应时间|并发|精度|同步时间|耗时/.test(text)) return "性能需求";
  if (/界面|页面|按钮|可视化|展示/.test(text)) return "页面/人机交互需求";
  if (/接口|协议|TCP|MQTT|调用|通信/.test(text)) return "接口需求";
  if (/数据库|数据表|字段|数据存储|数据管理|数据查询/.test(text)) return "数据需求";
  if (/环境|Linux|Windows|部署|运行环境/.test(text)) return "环境需求";
  if (/约束|技术栈|开发环境|编程语言|版本/.test(text)) return "设计实现约束";
  if (/验收|交付/.test(text)) return "验收交付需求";
  if (/可靠|维护|移植|伸缩|测试|易用|质量/.test(text)) return "质量属性需求";
  if (/元数据/.test(text)) return "元数据需求";
  return "功能需求";
}

function guessSubsystem(text) {
  if (/降水/.test(text)) return "降水仪";
  if (/重力波/.test(text)) return "重力波仪";
  if (/测云/.test(text)) return "测云仪";
  if (/平台|集成/.test(text)) return "数字孪生平台";
  return "全局";
}

function handleDesignJudgement(payload) {
  const items = Array.isArray(payload) ? payload : [];
  return {
    items: items.map((entry) => {
      const text = [entry.name, entry.description, entry.detail, entry.text].filter(Boolean).join("。");
      const fields = Array.isArray(entry.fields) ? entry.fields : [];
      const background = /文档概述|范围|引用文档|术语|目录|修订|读者|图$/.test(String(entry.name ?? ""));
      const designWords = /设计|模块|接口|页面|数据库|字段|输入|输出|调用|协议|功能|流程/.test(text);
      const accepted = entry.kind === "database" ? fields.length > 0 : !background && designWords && text.length >= 10;
      const typeHint =
        entry.kind === "database"
          ? "数据表"
          : entry.typeHint || (/页面/.test(text) ? "页面" : /接口/.test(text) ? "模块" : "模块");
      return {
        pointId: entry.pointId,
        isDesignUnit: accepted,
        confidence: accepted ? 0.88 : 0.7,
        reason: accepted ? "mock: 描述了可实现的设计结构。" : "mock: 背景/说明性文本，不构成独立设计单元。",
        typeHint,
      };
    }),
  };
}

function handleDesignGeneration(payload) {
  const items = Array.isArray(payload) ? payload : [];
  return {
    items: items.map((entry) => {
      const source = [entry.name, entry.description, entry.detail, entry.text].filter(Boolean).join("。");
      const type =
        entry.kind === "database"
          ? "数据表"
          : entry.kind === "table" && entry.typeHint
            ? entry.typeHint
            : entry.typeHint === "页面"
              ? "页面"
              : "模块";
      return {
        pointId: entry.pointId,
        name: entry.name,
        type,
        summary: String(source).slice(0, 100),
        obligations: [
          "实现设计描述中定义的功能",
          "按接口约定处理输入并返回输出",
          "保证数据结构与字段约束一致",
          "处理异常与边界条件",
        ],
        keywords: [type, entry.name, "设计", "接口"].filter(Boolean),
      };
    }),
  };
}

function handleTaxonomy(payload) {
  const chapters = Array.isArray(payload) ? payload : [];
  const categoryFor = (chapterPath) => {
    const text = String(chapterPath ?? "");
    if (/降水/.test(text)) return "降水仪";
    if (/重力波/.test(text)) return "重力波仪";
    if (/测云/.test(text)) return "测云仪";
    if (/平台|集成|外部接口|内部接口|数据需求|性能需求|安全|环境|验收|质量属性|元数据/.test(text)) {
      return "数字孪生平台";
    }
    return "全局";
  };
  const categoryDescriptions = {
    数字孪生平台: "平台级功能、接口、数据与非功能要求",
    降水仪: "降水粒子三维成像测量仪相关需求",
    重力波仪: "重力波温度光谱测试仪相关需求",
    测云仪: "可见光红外联合测云仪相关需求",
    全局: "跨子系统或无法归属的需求",
  };
  const names = new Set(chapters.map((chapter) => categoryFor(chapter.chapterPath)));
  return {
    categories: [...names].map((name) => ({ name, description: categoryDescriptions[name] ?? "" })),
    assignments: chapters.map((chapter) => ({
      chapterPath: chapter.chapterPath,
      category: categoryFor(chapter.chapterPath),
    })),
  };
}

function handleUnitGeneration(payload) {
  const items = Array.isArray(payload) ? payload : [];
  return {
    items: items.map((entry) => {
      const source = [entry.description, entry.detail, entry.text].filter(Boolean).join("。");
      const titleSource = entry.description || entry.text || "";
      const type = guessRequirementType(source);
      const subsystem = guessSubsystem(source);
      return {
        pointId: entry.pointId,
        title: String(titleSource).slice(0, 38),
        type,
        subsystem,
        summary: String(source).slice(0, 80),
        obligations: [
          "提供需求文本中描述的核心能力",
          "按需求说明处理输入并返回约定结果",
          "提供异常与边界条件处理",
          "支持需求涉及的角色或使用场景",
        ],
        keywords: [type, subsystem, "需求", "一致性"],
      };
    }),
  };
}

function handleRequirementEval(payload) {
  const items = Array.isArray(payload) ? payload : [];
  return {
    items: items.map((entry) => {
      const req = entry.requirement ?? {};
      const candidates = entry.candidates ?? [];
      const obligations = Array.isArray(req.obligations) ? req.obligations : [];
      if (!candidates.length || !obligations.length) {
        return {
          requirementCode: req.code,
          targetCoverages: [],
        };
      }

      // Mock intentionally splits obligations across two designs to exercise
      // union coverage; a single candidate receives all obligations.
      const split = candidates.length >= 2 && obligations.length >= 2;
      if (!split) {
        return {
          requirementCode: req.code,
          targetCoverages: [
            {
              designCode: candidates[0].code,
              coveredObligations: obligations.map((item) => item.id),
              partialObligations: [],
              conflictingObligations: [],
              evidence: String(candidates[0].description ?? "").slice(0, 100),
              confidence: 0.88,
            },
          ],
        };
      }

      const half = Math.ceil(obligations.length / 2);
      return {
        requirementCode: req.code,
        targetCoverages: [
          {
            designCode: candidates[0].code,
            coveredObligations: obligations.slice(0, half).map((item) => item.id),
            partialObligations: [],
            conflictingObligations: [],
            evidence: String(candidates[0].description ?? "").slice(0, 100),
            confidence: 0.9,
          },
          {
            designCode: candidates[1].code,
            coveredObligations: obligations.slice(half).map((item) => item.id),
            partialObligations: [],
            conflictingObligations: [],
            evidence: String(candidates[1].description ?? "").slice(0, 100),
            confidence: 0.82,
          },
        ],
      };
    }),
  };
}

function handleCodeEval(payload) {
  const items = Array.isArray(payload) ? payload : [];
  return {
    items: items.map((entry) => {
      const design = entry.design ?? {};
      const candidates = entry.candidates ?? [];
      if (!candidates.length) {
        return {
          designCode: design.code,
          status: "missing",
          targetHandles: [],
          confidence: 0.8,
          rationale: "mock: 代码快照中没有候选实现。",
          evidence: "",
          gaps: ["缺少实现"],
          suggestions: "按设计补齐代码。",
        };
      }
      if (design.type === "页面") {
        return {
          designCode: design.code,
          status: "partial",
          targetHandles: ["C1"],
          confidence: 0.66,
          rationale: "mock: 存在页面组件，但交互与状态覆盖不完整。",
          evidence: `${candidates[0].file}:${candidates[0].line}`,
          gaps: ["部分页面状态与交互未实现"],
          suggestions: "补齐页面交互与异常状态。",
        };
      }
      return {
        designCode: design.code,
        status: "implemented",
        targetHandles: ["C1"],
        confidence: 0.84,
        rationale: `mock: 代码符号「${candidates[0].name}」实现设计接口。`,
        evidence: `${candidates[0].file}:${candidates[0].line}`,
        gaps: [],
        suggestions: "",
      };
    }),
  };
}

function handleEnrich(text) {
  const payload = extractJson(text);
  const items = Array.isArray(payload) ? payload : [];
  if (text.includes("待处理需求")) {
    return {
      items: items.map((req) => ({
        code: req.code,
        type: req.currentType,
        summary: `mock 摘要：${String(req.title ?? "").slice(0, 40)}`,
        obligations: [
          "提供需求描述中的核心能力",
          "保证输入输出与文档一致",
          "提供可验证的异常处理",
        ],
        keywords: ["mock", req.subsystem ?? "系统"],
        confidence: 0.9,
      })),
    };
  }
  return {
    items: items.map((design) => ({
      code: design.code,
      summary: `mock 设计摘要：${String(design.name ?? "").slice(0, 40)}`,
      obligations: [
        "实现设计描述中的功能",
        "提供设计接口并返回约定结果",
        "处理输入校验与异常",
        "保持数据结构与字段一致",
      ],
      keywords: ["mock", design.subsystem ?? "系统"],
      confidence: 0.9,
    })),
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, calls }));
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end("not found");
    return;
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    calls++;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    const messages = body.messages ?? [];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    let payload;
    if (system.includes("连通性测试")) {
      payload = { content: "正常" };
    } else if (system.includes("判断每一段文本是否构成")) {
      payload = handleTextJudgement(extractJson(user));
    } else if (system.includes("判断每个候选是否构成")) {
      payload = handleDesignJudgement(extractJson(user));
    } else if (system.includes("把每个已确认的设计点")) {
      payload = handleDesignGeneration(extractJson(user));
    } else if (system.includes("资深需求架构师")) {
      payload = handleTaxonomy(extractJson(user));
    } else if (system.includes("把每个已确认的需求点转换为")) {
      payload = handleUnitGeneration(extractJson(user));
    } else if (system.includes("正在构建") && system.includes("需求")) {
      payload = handleEnrich(user);
    } else if (system.includes("正在构建") && system.includes("设计")) {
      payload = handleEnrich(user);
    } else if (user.includes("请评审以下需求与候选设计")) {
      payload = handleRequirementEval(extractJson(user));
    } else if (user.includes("请评审以下设计单元与候选代码")) {
      payload = handleCodeEval(extractJson(user));
    } else {
      payload = { content: "正常" };
    }
    const content = payload.content ?? JSON.stringify(payload);
    const response = {
      id: `mock-${calls}`,
      object: "chat.completion",
      model: body.model ?? "mock-model",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock LLM listening on http://127.0.0.1:${port}/v1`);
});
