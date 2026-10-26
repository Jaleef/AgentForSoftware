import type {
  Campaign,
  CodeFile,
  DocumentKind,
  DocumentSummary,
  LlmSettings,
  ProjectSummary,
  Relation,
  RequirementType,
  SettingsResponse,
  SnapshotMeta,
  StoredDocument,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: unknown = undefined;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    const message = (payload as { error?: string } | undefined)?.error ?? `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  listProjects: () =>
    request<{ projects: ProjectSummary[] }>("/projects").then((response) => response.projects),
  getProject: (projectId: string) => request<{ project: ProjectSummary }>(`/projects/${projectId}`).then((r) => r.project),
  createProject: (name: string, description: string) =>
    request<{ project: { id: string } }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }).then((r) => r.project),
  deleteProject: (projectId: string) => request<{ ok: boolean }>(`/projects/${projectId}`, { method: "DELETE" }),

  listDocuments: (projectId: string) =>
    request<{ documents: DocumentSummary[] }>(`/projects/${projectId}/documents`).then((r) => r.documents),
  getDocument: (projectId: string, kind: DocumentKind) =>
    request<{ document: StoredDocument }>(`/projects/${projectId}/documents/${kind}`).then((r) => r.document),
  uploadDocument: (projectId: string, kind: DocumentKind, file: File, useLlm: boolean) => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    form.append("useLlm", String(useLlm));
    return request<{ document: DocumentSummary }>(`/projects/${projectId}/documents`, {
      method: "POST",
      body: form,
    }).then((r) => r.document);
  },
  deleteDocument: (projectId: string, docId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/documents/${docId}`, { method: "DELETE" }),
  reparseDocument: (projectId: string, docId: string) =>
    request<{ document: DocumentSummary }>(`/projects/${projectId}/documents/${docId}/reparse`, {
      method: "POST",
    }).then((r) => r.document),
  enrichDocument: (projectId: string, docId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/documents/${docId}/enrich`, { method: "POST" }),
  patchRequirement: (
    projectId: string,
    code: string,
    patch: { type?: RequirementType; reviewNote?: string; reviewStatus?: "pending" | "confirmed" },
  ) =>
    request<{ unit: unknown }>(`/projects/${projectId}/requirements/${code}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  patchDesignUnit: (
    projectId: string,
    code: string,
    patch: { reviewNote?: string; reviewStatus?: "pending" | "confirmed" },
  ) =>
    request<{ unit: unknown }>(`/projects/${projectId}/design-units/${code}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listSnapshots: (projectId: string) =>
    request<{ snapshots: SnapshotMeta[] }>(`/projects/${projectId}/snapshots`).then((r) => r.snapshots),
  latestSnapshot: (projectId: string) =>
    request<{ snapshot: SnapshotMeta }>(`/projects/${projectId}/snapshots/latest`).then((r) => r.snapshot),
  registerSnapshot: (projectId: string, rootPath: string, commit: string) =>
    request<{ snapshot: SnapshotMeta }>(`/projects/${projectId}/snapshots`, {
      method: "POST",
      body: JSON.stringify({ rootPath, commit }),
    }).then((r) => r.snapshot),
  getSnapshotFile: (projectId: string, snapshotId: string, path: string) =>
    request<{ file: CodeFile }>(
      `/projects/${projectId}/snapshots/${snapshotId}/file?path=${encodeURIComponent(path)}`,
    ).then((r) => r.file),
  deleteSnapshot: (projectId: string, snapshotId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/snapshots/${snapshotId}`, { method: "DELETE" }),

  listCampaigns: (projectId: string) =>
    request<{ campaigns: Campaign[] }>(`/projects/${projectId}/campaigns`).then((r) => r.campaigns),
  getCampaign: (projectId: string, campaignId: string) =>
    request<{ campaign: Campaign }>(`/projects/${projectId}/campaigns/${campaignId}`).then((r) => r.campaign),
  getCampaignStatus: (projectId: string, campaignId: string) =>
    request<{ campaign: Campaign }>(
      `/projects/${projectId}/campaigns/${campaignId}?statusOnly=1`,
    ).then((r) => r.campaign),
  createCampaign: (
    projectId: string,
    payload: { name?: string; levels: Array<"requirement_design" | "design_code">; subsystems: string[] },
  ) =>
    request<{ campaign: Campaign }>(`/projects/${projectId}/campaigns`, {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((r) => r.campaign),
  cancelCampaign: (projectId: string, campaignId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/campaigns/${campaignId}/cancel`, { method: "POST" }),
  deleteCampaign: (projectId: string, campaignId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/campaigns/${campaignId}`, { method: "DELETE" }),
  reviewRelation: (
    projectId: string,
    campaignId: string,
    relationId: string,
    reviewStatus: "pending" | "accepted" | "rejected",
    reviewNote = "",
  ) =>
    request<{ relation: Relation }>(
      `/projects/${projectId}/campaigns/${campaignId}/relations/${relationId}`,
      { method: "PATCH", body: JSON.stringify({ reviewStatus, reviewNote }) },
    ),
  exportReportUrl: (projectId: string, campaignId: string, format: "md" | "csv" | "json") =>
    `/api/projects/${projectId}/campaigns/${campaignId}/export?format=${format}`,

  getSettings: () => request<SettingsResponse>("/settings"),
  saveSettings: (llm: Partial<LlmSettings>, clearApiKey = false) =>
    request<SettingsResponse>("/settings", {
      method: "PUT",
      body: JSON.stringify({ llm, clearApiKey }),
    }),
  testSettings: (llm: Partial<LlmSettings>) =>
    request<{ ok: boolean; latencyMs: number; message: string }>("/settings/test", {
      method: "POST",
      body: JSON.stringify({ llm }),
    }),
};

export function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function formatShortDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}
