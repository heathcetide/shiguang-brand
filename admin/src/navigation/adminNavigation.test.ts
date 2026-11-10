import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import { adminPages, adminGroups, adminLink, adminLocation } from './adminNavigation';
describe('admin navigation compatibility',()=>{
  it('gives every implemented management route one discoverable menu entry',()=>{
    const routes=[...app.matchAll(/<Route path="([^"]+)" element=/g)].map(match=>match[1]).filter(path=>!path.startsWith('/') && !['*','security-audit','auth-services/captcha','auth-services/phone'].includes(path));
    expect(new Set(adminPages.map(page=>page.path)).size).toBe(adminPages.length);
    expect(adminPages.map(page=>page.path).sort()).toEqual(['/admin',...routes.map(route=>`/admin/${route}`)].sort());
  });
  it('matches exact routes rather than confusing kitchenware with its review queue',()=>{
    expect(adminLocation('/admin/kitchenware-mapping-reviews').page?.label).toBe('厨具映射审核');
    expect(adminLocation('/admin/kitchenware/').page?.label).toBe('厨具库');
    expect(adminLocation('/admin/missing').page).toBeUndefined();
  });
  it('builds task links with the precise destination filter',()=>{
    expect(adminLink('/admin/recipes',{reviewStatus:'pending'}).to).toBe('/admin/recipes?reviewStatus=pending');
    expect(adminLink('/admin/ingredients',{tab:'ugc'}).to).toBe('/admin/ingredients?tab=ugc');
    expect(adminGroups.flatMap(group=>group.pages).some(page=>page.path.includes('captcha'))).toBe(false);
    expect(()=>adminLink('/admin/security-audit')).toThrow();
  });
});
