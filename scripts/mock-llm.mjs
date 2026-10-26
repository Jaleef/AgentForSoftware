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

function handleRequirementEval(payload) {
  const items = Array.isArray(payload) ? payload : [];
  return {
    items: items.map((entry) => {
      const req = entry.requirement ?? {};
      const candidates = entry.candidates ?? [];
      const nonFunctional = ["性能需求", "安全保密需求", "环境需求", "验收交付需求", "质量属性需求"].includes(req.type);
      if (!candidates.length) {
        return {
          requirementCode: req.code,
          status: "missing",
          targetCodes: [],
          confidence: 0.8,
          rationale: "mock: 候选设计为空，判定为缺失。",
          evidence: "",
          gaps: ["未找到对应设计单元"],
          suggestions: "补充设计或更新需求归属。",
        };
      }
      if (nonFunctional) {
        return {
          requirementCode: req.code,
          status: "partial",
          targetCodes: [candidates[0].code],
          confidence: 0.62,
          rationale: "mock: 非功能需求仅找到部分支撑设计，需人工确认约束是否落实。",
          evidence: candidates[0].summary ?? "",
          gaps: ["非功能约束缺少可验证证据"],
          suggestions: "补充性能/安全/验收相关的设计与测试证据。",
        };
      }
      return {
        requirementCode: req.code,
        status: "satisfied",
        targetCodes: [candidates[0].code],
        confidence: 0.88,
        rationale: `mock: 设计「${candidates[0].name}」覆盖需求主要义务。`,
        evidence: (candidates[0].description ?? "").slice(0, 100),
        gaps: [],
        suggestions: "",
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
