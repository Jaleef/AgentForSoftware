---
id: ADR-0001
title: DOCX 使用自研 ZIP/OOXML 解析
status: accepted
date: 2026-11-08
deciders:
  - architecture
  - tech-lead
related_code:
  - server/src/parsers/zip.ts
  - server/src/parsers/xml.ts
  - server/src/parsers/docx.ts
supersedes: ""
---

# ADR-0001：DOCX 使用自研 ZIP/OOXML 解析

## 背景

系统需要在本地解析 DOCX 的段落、标题、表格、合并单元格和分页标记。引入 Python/LibreOffice 等外部运行时会让部署变复杂。

## 决策

使用 Node.js 原生能力实现最小 ZIP 读取器和容错 XML DOM，不依赖 Python 或 Office 自动化。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| mammoth 等库 | 上手快 | 对合并单元格/分页控制弱 | 不满足需求 |
| Python python-docx | 生态成熟 | 引入 Python 运行时 | 部署复杂 |
| LibreOffice 转换 | 兼容性好 | 重、慢、需外部进程 | 不适合本地轻量工具 |

## 后果

- 部署无 Python 依赖；
- 合并单元格、分页、表格标签可按项目需要定制；
- 需要自行维护解析器和测试；
- 只支持 DOCX，不覆盖 PDF/OCR。

## 验证

`pnpm smoke` 解析两份示例文档；新增 fixture 后做回归。
