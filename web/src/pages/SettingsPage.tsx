/**
 * LLM 设置页面。
 *
 * 展示/修改模型配置、测试连接，并提示开发环境 .env 接管状态。
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import { useResource } from "../hooks";
import { Button, Card, Notice, PageHeader, Spinner, Tag } from "../components/ui";
import { IconCheck, IconSettings, IconSpark } from "../components/Icons";
import type { LlmSettings } from "../types";

const PRESETS = [
  { key: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { key: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { key: "ollama", label: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
  { key: "custom", label: "自定义", baseUrl: "", model: "" },
];

interface FormState {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: string;
  maxTokens: string;
  concurrency: string;
  timeoutMs: string;
  jsonMode: boolean;
  mock: boolean;
}

const EMPTY: FormState = {
  baseUrl: "",
  model: "",
  apiKey: "",
  temperature: "0.1",
  maxTokens: "4096",
  concurrency: "3",
  timeoutMs: "120000",
  jsonMode: true,
  mock: false,
};

/**
 * LLM 设置页面入口。
 *
 * 区分开发环境 .env 接管和生产设置页写入，并支持连接测试。
 */
export function SettingsPage() {
  const resource = useResource(() => api.getSettings(), []);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [clearKey, setClearKey] = useState(false);

  useEffect(() => {
    const settings = resource.data?.settings;
    if (!settings) return;
    setForm({
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: "",
      temperature: String(settings.temperature),
      maxTokens: String(settings.maxTokens),
      concurrency: String(settings.concurrency),
      timeoutMs: String(settings.timeoutMs),
      jsonMode: settings.jsonMode,
      mock: settings.mock,
    });
  }, [resource.data]);

  const settings = resource.data?.settings;
  const meta = resource.data?.meta;
  const envMode = meta?.configSource === "env";

  function patch(patchValue: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patchValue }));
    setSaved(false);
  }

  function toPayload(): Partial<LlmSettings> {
    return {
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      temperature: Number(form.temperature),
      maxTokens: Number(form.maxTokens),
      concurrency: Number(form.concurrency),
      timeoutMs: Number(form.timeoutMs),
      jsonMode: form.jsonMode,
      mock: form.mock,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    };
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveSettings(toPayload(), clearKey);
      setMessage({ tone: "green", text: result.configured ? "配置已保存，LLM 已可用。" : "配置已保存。当前未启用真实 LLM，将使用启发式规则。" });
      setSaved(true);
      setForm((current) => ({ ...current, apiKey: "" }));
      setClearKey(false);
      resource.reload();
    } catch (err) {
      setMessage({ tone: "red", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.testSettings(toPayload());
      const sourceLabel = result.source === "env" ? ".env" : "设置页";
      const keyLabel = result.apiKeyHint ? `，Key：${result.apiKeyHint}` : "";
      setMessage({
        tone: "green",
        text: `连接成功（${result.latencyMs} ms，使用${sourceLabel}配置${keyLabel}）：${result.message}`,
      });
    } catch (err) {
      setMessage({ tone: "red", text: `连接失败：${(err as Error).message}` });
    } finally {
      setTesting(false);
    }
  }

  if (resource.loading && !resource.data) {
    return (
      <div className="loading-block">
        <Spinner label="加载设置…" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="设置"
        subtitle={
          envMode
            ? "开发环境：LLM 配置来自项目根目录 .env；部署环境使用本页配置"
            : "模型选择与配置：LLM 用于需求/设计摘要与一致性判定"
        }
        actions={
          <div className="settings-status">
            {envMode ? (
              <Tag tone="blue">开发环境 · .env</Tag>
            ) : (
              <Tag tone="gray">{meta?.environment === "development" ? "开发环境 · 页面" : "部署配置"}</Tag>
            )}
            {resource.data?.configured ? (
              <Tag tone="green">
                <IconCheck size={13} /> 已配置
              </Tag>
            ) : (
              <Tag tone="amber">未配置 LLM</Tag>
            )}
            {settings?.mock && <Tag tone="purple">演示模式</Tag>}
          </div>
        }
      />

      {envMode && (
        <Notice tone="blue">
          当前为开发环境，LLM 配置由 <span className="inline-code">{meta?.envFile}</span> 接管。
          修改 <span className="inline-code">.env</span> 后请重启 <span className="inline-code">pnpm dev</span>。
          部署环境（<span className="inline-code">pnpm build &amp;&amp; pnpm start</span>）不会读取该文件，请在本页配置模型。
        </Notice>
      )}
      {envMode && Boolean(meta?.shadowedKeys?.length) && (
        <Notice tone="amber">
          检测到启动进程已设置环境变量{" "}
          <span className="inline-code">{meta?.shadowedKeys?.join(", ")}</span>，它们优先于{" "}
          <span className="inline-code">.env</span>，因此页面显示的 Key 可能不是文件中的值。
          请移除这些环境变量后重启 <span className="inline-code">pnpm dev</span>。
        </Notice>
      )}
      {envMode && meta?.envFileChanged && (
        <Notice tone="amber">
          检测到 <span className="inline-code">.env</span> 在服务启动后被修改。当前进程仍在使用启动时加载的旧配置，
          请重启 <span className="inline-code">pnpm dev</span> 后再测试。
        </Notice>
      )}
      {meta?.environment === "development" && !envMode && (
        <Notice tone="amber">
          开发环境未检测到 .env 中的 LLM 配置，当前使用本页保存的配置。若要改用 .env，请填写
          <span className="inline-code"> LLM_BASE_URL / LLM_API_KEY / LLM_MODEL </span>并重启开发服务。
        </Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {resource.error && <Notice tone="red">{resource.error}</Notice>}

      <div className="settings-grid">
        <Card label="LLM PROVIDER" title="模型服务" className="settings-main">
          <div className="preset-row">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                className={`preset ${form.baseUrl === preset.baseUrl && preset.baseUrl ? "active" : ""}`}
                disabled={envMode}
                onClick={() =>
                  patch({
                    baseUrl: preset.baseUrl || form.baseUrl,
                    model: preset.model || form.model,
                  })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="form-row">
            <label className="field field-grow">
              <span>Base URL</span>
              <input
                value={form.baseUrl}
                placeholder="https://api.deepseek.com/v1"
                disabled={envMode}
                onChange={(event) => patch({ baseUrl: event.target.value })}
              />
              <small>兼容 OpenAI Chat Completions 接口，通常以 /v1 结尾。</small>
            </label>
            <label className="field">
              <span>模型名称</span>
              <input
                value={form.model}
                placeholder="deepseek-chat"
                disabled={envMode}
                onChange={(event) => patch({ model: event.target.value })}
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field field-grow">
              <span>API Key</span>
              <input
                type="password"
                value={form.apiKey}
                disabled={envMode}
                placeholder={
                  envMode
                    ? settings?.hasApiKey
                      ? `来自 .env：${settings.apiKeyHint}`
                      : "请在 .env 中填写 LLM_API_KEY"
                    : settings?.hasApiKey
                      ? `已保存：${settings.apiKeyHint}（留空保持不变）`
                      : "sk-..."
                }
                onChange={(event) => patch({ apiKey: event.target.value })}
              />
              <small>
                {envMode
                  ? `开发环境由 .env 接管：${meta?.envFile}`
                  : "仅保存在本机 data/settings.json，不会发送到除模型服务以外的地址。"}
              </small>
            </label>
            <label className="checkbox checkbox-inline">
              <input
                type="checkbox"
                checked={clearKey}
                disabled={envMode}
                onChange={(event) => setClearKey(event.target.checked)}
              />
              清除已保存的 Key
            </label>
          </div>

          <div className="form-row four">
            <label className="field">
              <span>Temperature</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={form.temperature}
                disabled={envMode}
                onChange={(event) => patch({ temperature: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Max Tokens</span>
              <input
                type="number"
                step="256"
                min="256"
                value={form.maxTokens}
                disabled={envMode}
                onChange={(event) => patch({ maxTokens: event.target.value })}
              />
            </label>
            <label className="field">
              <span>并发批次</span>
              <input
                type="number"
                min="1"
                max="8"
                value={form.concurrency}
                disabled={envMode}
                onChange={(event) => patch({ concurrency: event.target.value })}
              />
            </label>
            <label className="field">
              <span>超时 (ms)</span>
              <input
                type="number"
                step="1000"
                value={form.timeoutMs}
                disabled={envMode}
                onChange={(event) => patch({ timeoutMs: event.target.value })}
              />
            </label>
          </div>

          <div className="toggle-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.jsonMode}
                disabled={envMode}
                onChange={(event) => patch({ jsonMode: event.target.checked })}
              />
              请求 JSON 模式（服务端不支持时自动降级）
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.mock}
                disabled={envMode}
                onChange={(event) => patch({ mock: event.target.checked })}
              />
              演示模式（Mock，不调用真实模型）
            </label>
          </div>

          <div className="form-actions">
            <Button variant="primary" onClick={save} disabled={saving || envMode}>
              {envMode ? "由 .env 接管" : saving ? "保存中…" : "保存配置"}
            </Button>
            <Button
              variant="secondary"
              onClick={test}
              disabled={testing || !settings?.baseUrl || !settings?.model}
            >
              {testing ? "测试中…" : envMode ? "测试 .env 配置" : "测试连接"}
            </Button>
            {saved && <span className="hint">已保存</span>}
            {envMode && <span className="hint">修改 .env 后重启 pnpm dev</span>}
          </div>
        </Card>

        <div className="settings-side">
          <Card label="STATUS" title="当前状态">
            <div className="settings-list">
              <div>
                <span>配置来源</span>
                <strong>{envMode ? "开发环境 .env" : "设置页面"}</strong>
              </div>
              <div>
                <span>模型服务</span>
                <strong>{settings?.baseUrl || "—"}</strong>
              </div>
              <div>
                <span>模型</span>
                <strong>{settings?.model || "—"}</strong>
              </div>
              <div>
                <span>API Key</span>
                <strong>{settings?.hasApiKey ? settings.apiKeyHint : "未配置"}</strong>
              </div>
              <div>
                <span>评价通道</span>
                <strong>{resource.data?.configured && !settings?.mock ? "LLM + 规则" : "启发式规则"}</strong>
              </div>
            </div>
          </Card>

          <Card label="HOW IT WORKS" title="评价如何工作">
            <ol className="how-list">
              <li>
                <IconSettings size={15} />
                <span>解析 DOCX，按表格/章节拆分需求、设计单元与原子义务。</span>
              </li>
              <li>
                <IconSpark size={15} />
                <span>使用 LLM 对需求做类型分类、摘要与义务拆分（可选）。</span>
              </li>
              <li>
                <IconCheck size={15} />
                <span>检索候选设计与代码，由 LLM 逐条给出覆盖/缺失/不一致判定与证据。</span>
              </li>
              <li>
                <IconCheck size={15} />
                <span>汇总得分、门禁与问题清单；人工可确认或驳回判定。</span>
              </li>
            </ol>
            <p className="muted small">
              未配置 LLM 或开启 Mock 时，系统使用关键词/接口标识匹配的启发式规则，仅用于流程演示与初筛。
              开发环境优先读取项目根目录 .env；生产模式只读取本页保存的配置。
            </p>
          </Card>
        </div>
      </div>

      <Card label="SCORING" title="评分与门禁口径">
        <div className="scoring-grid">
          <div>
            <strong>判定状态</strong>
            <p>已覆盖 100 · 部分覆盖 60 · 偏离 30 · 不一致 20 · 缺失 0。被人工驳回的条目不计入。</p>
          </div>
          <div>
            <strong>需求覆盖率</strong>
            <p>（已覆盖需求数 + 0.5 × 部分覆盖需求数）÷ 需求总数。</p>
          </div>
          <div>
            <strong>设计实现覆盖率</strong>
            <p>（已实现设计单元 + 0.5 × 部分实现）÷ 设计单元总数。</p>
          </div>
          <div>
            <strong>门禁</strong>
            <p>综合得分 ≥ 85 通过；70–85 警告；低于 70 不通过。P0 问题需人工确认。</p>
          </div>
        </div>
      </Card>
    </>
  );
}
