/**
 * 共享 UI 组件。
 *
 * 提供 PageHeader、Card、Button、Tag、Spinner、ProgressBar 等基础组件。
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconAlert, IconCheck, IconRefresh } from "./Icons";

/**
 * 页面标题区。
 *
 * 统一页面 eyebrow、标题、副标题和右侧操作布局。
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">CONSISTENCY EVALUATION</div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}

/**
 * 通用卡片容器。
 *
 * 支持可选的 section label、标题和右上角操作。
 */
export function Card({
  label,
  title,
  actions,
  children,
  className = "",
  padded = true,
}: {
  label?: string;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${padded ? "card-padded" : ""} ${className}`}>
      {(label || title || actions) && (
        <div className="card-head">
          <div className="card-head-main">
            {label && <div className="card-label">{label}</div>}
            {title && <h2 className="card-title">{title}</h2>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";

/**
 * 通用按钮。
 *
 * 统一 primary/secondary/ghost/danger 等视觉变体和图标布局。
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
}) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function Tag({
  children,
  tone = "gray",
  className = "",
}: {
  children: ReactNode;
  tone?: "blue" | "green" | "amber" | "red" | "purple" | "gray" | "cyan";
  className?: string;
}) {
  return <span className={`tag tag-${tone} ${className}`}>{children}</span>;
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "blue" | "green" | "amber" | "red";
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? `stat-${tone}` : ""}`}>{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty ${compact ? "empty-compact" : ""}`}>
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {description && <div className="empty-desc">{description}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" style={{ width: size, height: size }} />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}

export function ProgressBar({ value, tone = "blue" }: { value: number; tone?: "blue" | "green" | "amber" | "red" }) {
  return (
    <div className="progress">
      <div className={`progress-bar progress-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function ScoreRing({
  score,
  size = 132,
  label = "一致性得分",
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const tone = score >= 85 ? "green" : score >= 70 ? "amber" : "red";
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} className="score-ring-bg" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={`score-ring-value ring-${tone}`}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="score-ring-inner">
        <div className={`score-number score-${tone}`}>{score.toFixed(1)}</div>
        <div className="score-caption">{label}</div>
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    parsed: { label: "已解析", tone: "green" },
    parsing: { label: "解析中", tone: "blue" },
    enriching: { label: "LLM 整理中", tone: "blue" },
    failed: { label: "失败", tone: "red" },
    queued: { label: "排队中", tone: "gray" },
    running: { label: "评价中", tone: "blue" },
    completed: { label: "已完成", tone: "green" },
    cancelled: { label: "已取消", tone: "gray" },
    ready: { label: "可用", tone: "green" },
  };
  const item = map[status] ?? { label: status, tone: "gray" };
  return <Tag tone={item.tone as "blue" | "green" | "amber" | "red" | "purple" | "gray" | "cyan"}>{item.label}</Tag>;
}

/**
 * 提示条。
 *
 * 用于成功、警告、错误和普通信息的页面级反馈。
 */
export function Notice({
  tone = "blue",
  icon,
  children,
  actions,
}: {
  tone?: "blue" | "amber" | "red" | "green";
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`}>
      <span className="notice-icon">{icon ?? (tone === "green" ? <IconCheck size={16} /> : tone === "red" ? <IconAlert size={16} /> : <IconAlert size={16} />)}</span>
      <div className="notice-body">{children}</div>
      {actions && <div className="notice-actions">{actions}</div>}
    </div>
  );
}

export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button className="icon-btn" onClick={onClick} title="刷新" disabled={loading}>
      <span className={loading ? "spin" : ""}>
        <IconRefresh size={17} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? "segment active" : "segment"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
