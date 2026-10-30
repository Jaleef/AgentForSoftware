/**
 * 前端路由入口。
 *
 * 定义项目、需求、设计、代码、评价、报告和设置页面路由。
 */

import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { RequirementsPage } from "./pages/RequirementsPage";
import { DesignPage } from "./pages/DesignPage";
import { CodePage } from "./pages/CodePage";
import { EvaluationPage } from "./pages/EvaluationPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { SettingsPage } from "./pages/SettingsPage";

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  return null;
}

/**
 * 定义前端路由表。
 *
 * 把项目、需求、设计、代码、评价、报告和设置页面挂载到对应 URL。
 */
export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/:projectId/requirements" element={<RequirementsPage />} />
          <Route path="/projects/:projectId/design" element={<DesignPage />} />
          <Route path="/projects/:projectId/code" element={<CodePage />} />
          <Route path="/projects/:projectId/evaluation" element={<EvaluationPage />} />
          <Route path="/projects/:projectId/reports" element={<ReportsPage />} />
          <Route path="/projects/:projectId/reports/:campaignId" element={<ReportDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
