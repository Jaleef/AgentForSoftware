/**
 * 子 Agent 注册表。
 *
 * 目前主 Agent 直接实例化子 Agent；注册表用于后续按配置选择实现。
 */

import type { SubAgent } from "./contracts.js";

export class AgentRegistry {
  private readonly agents = new Map<string, SubAgent<unknown, unknown>>();

  register<I, O>(agent: SubAgent<I, O>): void {
    this.agents.set(agent.name, agent as SubAgent<unknown, unknown>);
  }

  get(name: string): SubAgent<unknown, unknown> | undefined {
    return this.agents.get(name);
  }

  list(): string[] {
    return [...this.agents.keys()];
  }
}
