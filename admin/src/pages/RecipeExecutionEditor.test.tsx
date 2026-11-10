// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RecipeExecutionEditor } from './RecipeExecutionEditor';
import api from '../services/api';
vi.mock('../services/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
it('retains an invalid draft and shows authoritative validation details without announcing success', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(api.get).mockImplementation(async url => ({ data: url.includes('catalog') ? [] : {
    recipeKey: 'a'.repeat(64), reviewKey: 'b'.repeat(64), execution: { profile: {
      version: 1, reference: 'short', maxBatchServings: 1, tools: [],
      tasks: [{ id: 'cook', title: 'Cook', phase: 'cooking', minutes: 2, active: true, dependsOn: [], tools: [] }],
    } },
  } }));
  vi.mocked(api.put).mockRejectedValue({ response: { data: { code: 'VALIDATION_ERROR', error: '请求参数不正确', details: [{ path: 'profile.reference', message: '请补充审核依据' }] } } });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<RecipeExecutionEditor recipeId={1} />));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '审核保存制作流程')!.click());
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role=status]')!.textContent).toBe('请补充审核依据');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('short');
    expect(host.querySelector('fieldset')!.disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
