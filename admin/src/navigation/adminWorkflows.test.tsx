import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import AdminWorkflowLayout from '../layout/AdminWorkflowLayout';
import { activeWorkflowTab, adminWorkflows, workflowTabHref } from './adminWorkflows';
import { adminGroups, adminLocation, adminParentPath, isAdminGroupOpen } from './adminNavigation';
import { failureRunStatuses, waitingRunStatuses } from '../pages/dashboardRunStatuses';

describe('consolidated admin workflows', () => {
  it('keeps all original routes within the existing protected admin layout', () => {
    const protectedRoutes = app.slice(app.indexOf('path="/admin"'));
    expect(protectedRoutes).toContain('<ProtectedRoute>');
    expect(protectedRoutes).toContain('<AdminLayout />');
    for (const workflow of Object.values(adminWorkflows)) for (const tab of workflow.tabs) {
      expect(protectedRoutes).toContain(`path="${tab.path.replace('/admin/', '')}"`);
      expect(adminLocation(tab.path).page).toBeDefined();
    }
    expect(adminGroups.flatMap(group => group.pages)).toHaveLength(17);
  });
  it('selects the parent menu for hidden deep links and expands only daily groups by default', () => {
    for (const [path, parent, technical] of [
      ['/admin/kitchenware-mapping-reviews', '/admin/kitchenware', false],
      ['/admin/user-level-rule', '/admin/users', false],
      ['/admin/voice-packs', '/admin/ai-providers', true],
      ['/admin/ai-services', '/admin/ai-providers', true],
      ['/admin/ai-config', '/admin/ai-providers', true],
      ['/admin/agent-runs', '/admin/ai-conversations', true],
    ] as const) {
      expect(adminParentPath(`${path}/`)).toBe(parent);
      expect(!!adminLocation(path).group?.technical).toBe(technical);
    }
    for (const group of adminGroups) {
      expect(isAdminGroupOpen(group, {})).toBe(!group.technical);
      expect(isAdminGroupOpen(group, { [group.id]: false })).toBe(false);
      expect(isAdminGroupOpen(group, { [group.id]: true })).toBe(true);
    }
  });
  it('reads tab selection from the URL, including legacy defaults and malformed bookmarks', () => {
    const tabs = adminWorkflows.kitchenware.tabs;
    expect(activeWorkflowTab(tabs, '/admin/kitchenware', '')).toBe(0);
    expect(activeWorkflowTab(tabs, '/admin/kitchenware/', '?tab=assets&q=pot')).toBe(1);
    expect(activeWorkflowTab(tabs, '/admin/kitchenware', '?tab=unknown')).toBe(0);
    expect(activeWorkflowTab(tabs, '/admin/kitchenware-mapping-reviews', '?status=pending')).toBe(2);
    expect(activeWorkflowTab(adminWorkflows.diagnostics.tabs, '/admin/agent-runs', '?status=failed&runId=42')).toBe(1);
  });
  it('retains existing query parameters and hash when changing kitchenware tabs', () => {
    const href = workflowTabHref(adminWorkflows.kitchenware.tabs[1], '?q=锅&status=良好&page=3&id=42', '#selected');
    const url = new URL(href, 'https://example.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '锅', status: '良好', page: '3', id: '42', tab: 'assets' });
    expect(url.hash).toBe('#selected');
  });
  it('renders navigable deep-link tabs and a page outlet without leaking filters across APIs', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/agent-runs?status=failed&runId=42#selected']}><Routes>
      <Route element={<AdminWorkflowLayout workflow="diagnostics" />}>
        <Route path="/admin/agent-runs" element={<p>Run detail</p>} />
      </Route>
    </Routes></MemoryRouter>);
    expect(html).toContain('aria-label="AI 诊断"');
    expect(html).toContain('href="/admin/ai-conversations"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/admin/agent-runs?status=failed&amp;runId=42#selected"');
    expect(html).toContain('Run detail');
    expect(html).not.toContain('role="tab"'); // Real links retain native keyboard/history behavior.
  });
  it('never classifies a waiting user workflow as a failure', () => {
    expect(failureRunStatuses.map(item => item.status)).toEqual(['failed', 'expired']);
    expect(waitingRunStatuses.map(item => item.status)).toEqual(['awaiting_input', 'awaiting_approval']);
  });
});
