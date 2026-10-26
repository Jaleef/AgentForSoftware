import type { DesignUnit, RequirementType, RequirementUnit } from "./types";

export type Tone = "blue" | "green" | "amber" | "red" | "purple" | "gray" | "cyan";

const REQUIREMENT_TONE: Record<string, Tone> = {
  功能需求: "blue",
  性能需求: "amber",
  "页面/人机交互需求": "cyan",
  接口需求: "purple",
  数据需求: "green",
  环境需求: "gray",
  安全保密需求: "red",
  设计实现约束: "amber",
  验收交付需求: "cyan",
  质量属性需求: "purple",
  元数据需求: "green",
  用例需求: "gray",
  其他需求: "gray",
};

export function requirementTone(type: RequirementType | string): Tone {
  return REQUIREMENT_TONE[type] ?? "gray";
}

export function designTone(type: DesignUnit["type"] | string): Tone {
  if (type === "子功能") return "blue";
  if (type === "模块") return "cyan";
  if (type === "数据表") return "green";
  if (type === "页面") return "purple";
  return "gray";
}

export function levelLabel(level: string): string {
  return level === "requirement_design" ? "需求 → 设计" : "设计 → 代码";
}

export function unitLocator(unit: RequirementUnit | DesignUnit): string {
  if (!unit.location.page) return "手工添加";
  return `第 ${unit.location.page} 页 · 第 ${unit.location.line} 行`;
}

export function groupBySubsystem<T extends { subsystem: string }>(items: T[]): Array<{ subsystem: string; items: T[] }> {
  const order = ["数字孪生平台", "降水仪", "重力波仪", "测云仪", "全局"];
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.subsystem) ?? [];
    list.push(item);
    map.set(item.subsystem, list);
  }
  return [...map.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([subsystem, list]) => ({ subsystem, items: list }));
}
