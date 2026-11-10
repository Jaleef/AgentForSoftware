---
id: ADR-0005
title: 当前采用单用户 JSON 存储
status: superseded
date: 2026-11-08
superseded_by: ADR-0007
deciders:
  - architecture
  - ops
related_code:
  - server/src/store.ts
supersedes: ""
---

# ADR-0005：当前采用单用户 JSON 存储

> **已被 [ADR-0007](ADR-0007-sqlite-storage.md) 替代**：2026-11-10 起主存储迁移到本地 SQLite。本文保留为历史决策记录。

## 背景

系统定位为本地单用户工具，需要零数据库依赖、快速部署和可读的数据备份。

## 决策

使用 `data/store.json`、`data/settings.json` 和 `data/uploads/`，写操作通过 `mutateStore` 串行化并临时文件替换。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| JSON 文件 | 零依赖、可读、易备份 | 全量写、无并发、规模有限 | 采用（当前阶段） |
| SQLite | 事务、查询、单文件 | 增加依赖/迁移 | 下一阶段 |
| Postgres | 多用户、并发 | 部署重 | 非当前目标 |

## 后果

- 单进程、单用户；
- 不适合多实例共享；
- 数据量大时写入变慢；
- 没有事务级回滚；
- 评价任务在进程内运行，重启会中断。

## 后续

如果进入团队部署，优先迁移 SQLite，再考虑任务队列和权限；迁移前保留 JSON 备份。
