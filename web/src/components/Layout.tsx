/**
 * 应用整体布局。
 *
 * 提供侧边导航、当前项目选择器、页面内容容器和设置入口。
 */

import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../hooks";
import {
  IconCode,
  IconFile,
  IconFolder,
  IconLayers,
  IconLink,
  IconRefresh,
  IconReport,
  IconSettings,
} from "./Icons";

function projectIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1];
}

const NAV = [
  { key: "project", label: "项目", desc: "项目、文档与代码快照", icon: IconFolder, suffix: "" },
  { key: "requirements", label: "需求", desc: "需求拆分与结构", icon: IconFile, suffix: "/requirements" },
  { key: "design", label: "设计", desc: "设计结构与模块", icon: IconLayers, suffix: "/design" },
  { key: "code", label: "代码", desc: "代码结构与实现映射", icon: IconCode, suffix: "/code" },
  { key: "evaluation", label: "一致性评价", desc: "需求 → 设计 → 代码", icon: IconLink, suffix: "/evaluation" },
  { key: "reports", label: "评价报告", desc: "报告与门禁", icon: IconReport, suffix: "/reports" },
];

/**
 * 渲染应用外壳。
 *
 * 包含侧边导航、项目选择器、页面内容插槽和设置入口。
 */
export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const projectId = projectIdFromPath(location.pathname);
  const projects = useResource(() => api.listProjects(), [], { key: "projects-nav" });
  const selectedId = projectId ?? projects.data?.[0]?.id ?? "";
  const current = projects.data?.find((p) => p.id === selectedId);

  const navItems = NAV.map((item) => ({
    ...item,
    to: item.key === "project" ? (projectId ? `/projects/${projectId}` : "/") : projectId ? `/projects/${projectId}${item.suffix}` : "/",
  }));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">CE</div>
          <div className="brand-text">
            <strong>一致性评价</strong>
            <span>需求 · 设计 · 代码</span>
          </div>
        </div>

        <div className="project-switch">
          <label>当前项目</label>
          <select
            value={selectedId}
            onChange={(event) => {
              const next = event.target.value;
              if (next) navigate(`/projects/${next}`);
              else navigate("/");
            }}
          >
            <option value="">选择项目…</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.key === "project"}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                <span className="nav-icon">
                  <Icon size={19} />
                </span>
                <span className="nav-text">
                  <span className="nav-label">{item.label}</span>
                  <span className="nav-desc">{item.desc}</span>
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
            <span className="nav-icon">
              <IconSettings size={19} />
            </span>
            <span className="nav-text">
              <span className="nav-label">设置</span>
              <span className="nav-desc">模型选择与配置</span>
            </span>
          </NavLink>
          <div className="sidebar-version">Software Quality Agent · v1.0</div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <div className="avatar" title={current?.name ?? "未选择项目"}>
              {current ? current.name.slice(0, 2).toUpperCase() : "—"}
            </div>
            <button className="btn btn-secondary btn-sm" title="刷新页面" onClick={() => window.location.reload()}>
              <IconRefresh size={14} /> 刷新
            </button>
          </div>
        </div>
        <div className="page">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
