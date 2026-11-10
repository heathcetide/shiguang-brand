// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Kitchenware from './Kitchenware';
import Recipes from './Recipes';
import api from '../services/api';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(api.get), post = vi.mocked(api.post), put = vi.mocked(api.put), remove = vi.mocked(api.delete);
const deferred = () => {
  let resolve!: (data: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => { resolve = data => yes({ data }); reject = no; });
  return { promise, resolve, reject };
};
let host: HTMLDivElement, root: Root, navigate: ReturnType<typeof useNavigate>;
function Navigation() { navigate = useNavigate(); return null; }
async function mount(page: React.ReactNode) {
  await act(async () => root.render(<MemoryRouter><Navigation />{page}</MemoryRouter>));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
function button(text: string, index = 0) {
  const found = [...host.querySelectorAll('button')].filter(b => b.textContent === text || b.getAttribute('aria-label') === text || b.title === text)[index];
  expect(found, text).toBeDefined(); return found;
}
async function click(text: string, index = 0) { await act(async () => button(text, index).click()); }
async function input(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const dialogName = () => host.querySelector('[role="dialog"] input') as HTMLInputElement;
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'prompt').mockReturnValue('Reviewed evidence');
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
const catalog = [{ id: 1, name: 'Pot A', category: '其他' }, { id: 2, name: 'Pot B', category: '其他' }];
function mockCatalog() { get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/catalog') ? catalog : [] })); }

it.each(['edit', 'create'])('guards same-tick duplicate catalog %s submissions', async mode => {
  const pending = deferred(); mockCatalog(); put.mockReturnValue(pending.promise); post.mockReturnValue(pending.promise);
  await mount(<Kitchenware />); await click(mode === 'edit' ? '编辑' : '新增官方厨具');
  if (mode === 'create') await input(dialogName(), 'New pot');
  await act(async () => {
    const form = host.querySelector('form')!;
    for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await click('保存');
  expect(mode === 'edit' ? put : post).toHaveBeenCalledTimes(1);
  expect(button('保存').disabled).toBe(true);
  await act(async () => pending.resolve({}));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it.each(['关闭', '取消', 'escape', 'backdrop'])('prevents pending catalog save from losing another draft via %s', async dismissal => {
  const pending = deferred(); mockCatalog(); put.mockReturnValue(pending.promise);
  await mount(<Kitchenware />); await click('编辑'); await input(dialogName(), 'Pot A changed'); await submit();
  if (dismissal === 'escape') await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  else if (dismissal === 'backdrop') await act(async () => (host.querySelector('[role="dialog"]') as HTMLElement).click());
  else await click(dismissal);
  await click('编辑', 1); // Even a programmatic click behind the modal cannot switch its owner.
  expect(dialogName().value).toBe('Pot A changed');
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
  expect(put.mock.calls[0][0]).toBe('/admin/kitchenware/catalog/1');
  await act(async () => pending.resolve({}));
  await click('编辑', 1); await input(dialogName(), 'Pot B changed');
  expect(dialogName().value).toBe('Pot B changed');
});

it('retains catalog input on failure and releases the guard for retry', async () => {
  const pending = deferred(), retry = deferred(); mockCatalog(); put.mockReturnValueOnce(pending.promise).mockReturnValueOnce(retry.promise);
  await mount(<Kitchenware />); await click('编辑'); await input(dialogName(), 'Keep my draft'); await submit();
  await act(async () => pending.reject(new Error('offline')));
  expect(dialogName().value).toBe('Keep my draft'); expect(button('保存').disabled).toBe(false);
  expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('保存官方厨具失败');
  await submit(); expect(put).toHaveBeenCalledTimes(2);
  expect(put.mock.calls[1]).toEqual(put.mock.calls[0]);
  expect(host.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
  expect(dialogName().value).toBe('Keep my draft');
  await act(async () => retry.resolve({})); expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it.each(['resolve', 'reject'] as const)('ignores unmounted catalog save %s without affecting a new page draft', async outcome => {
  const pending = deferred(); mockCatalog(); put.mockReturnValue(pending.promise);
  await mount(<Kitchenware />); await click('编辑'); await submit();
  await act(async () => root.render(null)); await mount(<Kitchenware />); await click('编辑', 1); await input(dialogName(), 'New page draft');
  const count = get.mock.calls.length;
  await act(async () => { if (outcome === 'resolve') pending.resolve({}); else pending.reject(new Error('old')); });
  expect(get).toHaveBeenCalledTimes(count); expect(dialogName().value).toBe('New page draft');
  expect(host.textContent).not.toContain('保存官方厨具失败'); expect(button('保存').disabled).toBe(false);
});

const recipe = (id: number) => ({ id, title: `Recipe ${id}`, category: '减脂餐', source: 'user', status: 'pending', quality_status: 'trusted', ingredients_json: '[]', steps_json: '[]' });
function mockRecipes() { get.mockImplementation((_url, config: any) => Promise.resolve({ data: { items: [recipe(config.params.search === 'new' ? 2 : 1)] } })); }
async function beginRecipeMutation(action: string) {
  if (action === 'save') { await click('编辑'); await submit(); }
  else await click(action);
}
it.each(['通过', '驳回', '待复核', '删除', 'save'])('refreshes committed recipe filters after %s, preserving the original mutation target', async action => {
  const pending = deferred(); mockRecipes(); post.mockReturnValue(pending.promise); put.mockReturnValue(pending.promise); remove.mockReturnValue(pending.promise);
  await mount(<Recipes />); await beginRecipeMutation(action);
  await act(async () => navigate('?q=new&category=增肌&source=official&reviewStatus=approved&qualityStatus=estimated'));
  expect(host.textContent).toContain('Recipe 2');
  await act(async () => pending.resolve({}));
  expect(host.textContent).toContain('Recipe 2'); expect(host.textContent).not.toContain('Recipe 1');
  expect(get.mock.calls.at(-1)?.[1]?.params).toMatchObject({ search: 'new', category: '增肌', source: 'official', reviewStatus: 'approved', qualityStatus: 'estimated' });
  const mutation = action === 'save' || action === '待复核' ? put : action === '删除' ? remove : post;
  expect(mutation).toHaveBeenCalledTimes(1); expect(mutation.mock.calls[0][0]).toMatch(/^\/admin\/recipes\/1(?:\/|$)/);
});

it.each(['resolve', 'reject'] as const)('ignores obsolete recipe list %s and finally while post-mutation current-query refresh is pending', async outcome => {
  const mutation = deferred(), obsolete = deferred(), latest = deferred(); mockRecipes(); post.mockReturnValue(mutation.promise);
  await mount(<Recipes />); await click('通过');
  get.mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(latest.promise);
  await act(async () => navigate('?q=new'));
  await act(async () => mutation.resolve({}));
  await act(async () => { if (outcome === 'resolve') obsolete.resolve({ items: [recipe(9)] }); else obsolete.reject(new Error('old')); });
  expect(host.textContent).not.toContain('Recipe 9'); expect(host.textContent).not.toContain('读取食谱失败');
  expect(button('刷新').disabled).toBe(true);
  await act(async () => latest.resolve({ items: [recipe(2)] })); expect(host.textContent).toContain('Recipe 2');
});

it.each(['通过', '驳回', '待复核', '删除', 'save'].flatMap(action => ['resolve', 'reject'].map(outcome => [action, outcome])))('does not refresh or alert after unmounted recipe mutation %s %s', async (action, outcome) => {
  const pending = deferred(); mockRecipes(); post.mockReturnValue(pending.promise); put.mockReturnValue(pending.promise); remove.mockReturnValue(pending.promise);
  await mount(<Recipes />); await beginRecipeMutation(action); await act(async () => root.render(null));
  const count = get.mock.calls.length;
  await act(async () => { if (outcome === 'resolve') pending.resolve({}); else pending.reject(new Error('old')); });
  expect(get).toHaveBeenCalledTimes(count); expect(window.alert).not.toHaveBeenCalled();
});
it('keeps the recipe draft on save failure and retries against the original ID with current filters', async () => {
  const pending = deferred(); mockRecipes(); put.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ data: {} });
  await mount(<Recipes />); await click('编辑'); await input(dialogName(), 'Keep recipe draft'); await submit();
  await act(async () => navigate('?q=new'));
  await act(async () => pending.reject(new Error('offline')));
  expect(dialogName().value).toBe('Keep recipe draft'); expect(window.alert).toHaveBeenCalled();
  await submit(); expect(put).toHaveBeenCalledTimes(2); expect(put.mock.calls[1]).toEqual(put.mock.calls[0]);
  expect(put.mock.calls[1][0]).toBe('/admin/recipes/1'); expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(get.mock.calls.at(-1)?.[1]?.params).toMatchObject({ search: 'new' });
});

it('keeps catalog save ownership live after StrictMode effect replay', async () => {
  const pending = deferred(); mockCatalog(); put.mockReturnValue(pending.promise);
  await mount(<StrictMode><Kitchenware /></StrictMode>); await click('编辑'); await submit(); await submit();
  expect(put).toHaveBeenCalledTimes(1); expect(button('保存').disabled).toBe(true);
  await act(async () => pending.resolve({})); expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click('编辑', 1); expect(dialogName().value).toBe('Pot B');
});
it('clears the catalog save error when switching to a different draft', async () => {
  mockCatalog(); put.mockRejectedValue(new Error('offline'));
  await mount(<Kitchenware />); await click('编辑'); await submit();
  expect(host.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
  await click('关闭'); await click('编辑', 1);
  expect(host.querySelector('[role="dialog"] [role="alert"]')).toBeNull(); expect(dialogName().value).toBe('Pot B');
});
