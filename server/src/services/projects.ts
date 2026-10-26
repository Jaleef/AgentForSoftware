import type { Campaign, CodeSnapshot, Project, StoredDocument, StoreData } from "../types.js";

export function latestDoc(data: StoreData, projectId: string, kind: "srs" | "sdd"): StoredDocument | undefined {
  return data.documents
    .filter((d) => d.projectId === projectId && d.kind === kind)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

export function latestSnapshot(data: StoreData, projectId: string): CodeSnapshot | undefined {
  return data.snapshots
    .filter((s) => s.projectId === projectId && s.status === "ready")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function projectCampaigns(data: StoreData, projectId: string): Campaign[] {
  return data.campaigns
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function summarizeProject(data: StoreData, project: Project) {
  const srs = latestDoc(data, project.id, "srs");
  const sdd = latestDoc(data, project.id, "sdd");
  const snapshot = latestSnapshot(data, project.id);
  const campaigns = projectCampaigns(data, project.id);
  const latest = campaigns[0];
  return {
    ...project,
    requirementDoc: srs
      ? {
        id: srs.id,
        originalName: srs.originalName,
        status: srs.status,
        uploadedAt: srs.uploadedAt,
        total: srs.requirements.length,
        version: srs.version,
        pageCount: srs.pageCount,
      }
      : undefined,
    designDoc: sdd
      ? {
        id: sdd.id,
        originalName: sdd.originalName,
        status: sdd.status,
        uploadedAt: sdd.uploadedAt,
        total: sdd.designUnits.length,
        version: sdd.version,
        pageCount: sdd.pageCount,
      }
      : undefined,
    snapshot: snapshot
      ? {
        id: snapshot.id,
        rootPath: snapshot.rootPath,
        commit: snapshot.commit,
        createdAt: snapshot.createdAt,
        files: snapshot.stats.files,
        symbols: snapshot.stats.symbols,
      }
      : undefined,
    campaignCount: campaigns.length,
    latestCampaign: latest
      ? {
        id: latest.id,
        name: latest.name,
        status: latest.status,
        score: latest.summary?.score,
        createdAt: latest.createdAt,
      }
      : undefined,
    requirementStats: {
      total: srs?.requirements.length ?? 0,
      byType: srs?.stats.byType ?? {},
      bySubsystem: srs?.stats.bySubsystem ?? {},
    },
    designStats: {
      total: sdd?.designUnits.length ?? 0,
      byType: sdd?.stats.byType ?? {},
      bySubsystem: sdd?.stats.bySubsystem ?? {},
    },
  };
}

export function projectOverview(data: StoreData, project: Project) {
  return summarizeProject(data, project);
}
