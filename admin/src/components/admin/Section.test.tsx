import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Section } from './Section';
import { remoteFailure, remoteSuccess } from '../../hooks/useRemoteSection';
it('does not render an empty-success message when the first request fails',()=>{
  const state={...remoteFailure({data:null,loading:true,error:'',updatedAt:null}),reload:()=>{}};
  const html=renderToStaticMarkup(<Section title="待审食谱" state={state}>暂无待办</Section>);
  expect(html).toContain('读取失败');expect(html).not.toContain('暂无待办');
});
it('shows both refresh failure and the last successful rows with their timestamp',()=>{
  const state={...remoteFailure(remoteSuccess([7],'2026-09-19T12:00:00Z')),reload:()=>{}};
  const html=renderToStaticMarkup(<Section title="待审食谱" state={state}>待处理食谱 #7</Section>);
  expect(html).toContain('保留上次读取的数据');expect(html).toContain('待处理食谱 #7');expect(html).toContain('更新于');
});
