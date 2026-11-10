import { describe, expect, it } from 'vitest';
import { parseQueryValue } from './useQueryState';
import { remoteFailure, remoteSuccess, type RemoteState } from './useRemoteSection';
describe('URL filter parsing',()=>{
  it('restores valid bookmarked review filters and rejects unsupported values',()=>{
    expect(parseQueryValue('pending','all',['all','pending','approved'])).toBe('pending');
    expect(parseQueryValue('deleted','all',['all','pending','approved'])).toBe('all');
    expect(parseQueryValue(null,'library',['library','ugc'])).toBe('library');
    expect(parseQueryValue('ugc','library',['library','ugc'])).toBe('ugc');
  });
  it('preserves Chinese search text and bounds arbitrary search input',()=>{
    expect(parseQueryValue('番茄 + 鸡蛋','')).toBe('番茄 + 鸡蛋');
    expect(parseQueryValue('x'.repeat(600),'').length).toBe(500);
  });
});
describe('independent workbench section failures',()=>{
  it('keeps unavailable data distinct from a successful empty queue',()=>{
    const failed=remoteFailure<unknown[]>({data:null,loading:true,error:'',updatedAt:null});
    expect(failed.data).toBeNull();expect(failed.error).toBeTruthy();expect(failed.loading).toBe(false);
    const empty=remoteSuccess([]);expect(empty.data).toEqual([]);expect(empty.error).toBe('');
  });
  it('retains data and its original timestamp when refresh fails',()=>{
    const previous:RemoteState<{items:number[]}>=remoteSuccess({items:[7]},'2026-09-19T12:00:00Z');
    const failed=remoteFailure(previous);
    expect(failed.data).toBe(previous.data);expect(failed.updatedAt).toBe(previous.updatedAt);
    const recovered=remoteSuccess({items:[]},'2026-09-20T12:00:00Z');
    expect(recovered.error).toBe('');expect(recovered.updatedAt).not.toBe(failed.updatedAt);
  });
});
