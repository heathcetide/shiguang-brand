import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import AgentRuns from './AgentRuns';

it('preserves run filter order and bookmarked selections while rejecting unknown values', () => {
  const renderFilters = (query: string) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/agent-runs?${query}`]}><AgentRuns /></MemoryRouter>);
    return html.match(/<select\b[^>]*>.*?<\/select>/g)!.slice(0, 2);
  };
  const [status, modality] = renderFilters('status=running&modality=audio');
  expect(status).toContain('<option value="running" selected="">运行中</option><option value="queued">排队中</option>');
  expect(status.match(/<option\b/g)).toHaveLength(9);
  expect(modality).toContain('<option value="audio" selected="">语音</option>');
  expect(modality.match(/<option\b/g)).toHaveLength(8);

  const defaults = renderFilters('status=unknown&modality=unknown');
  expect(defaults[0]).toContain('<option value="" selected="">全部状态</option>');
  expect(defaults[1]).toContain('<option value="" selected="">全部模态</option>');
});
