import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function loadData(root) {
  const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
  const manifest = read('manifest.json');
  for (const [name, expected] of Object.entries(manifest)) {
    const path = resolve(root, name);
    if (!path.startsWith(resolve(root) + sep)) throw new Error('Invalid archive path');
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) throw new Error('Data integrity failure');
  }
  return {
    summary: read('summary.json'), concepts: read('concepts.json'), forms: read('ingredient-forms.json'),
    recipes: read('recipe-concepts.json'), methods: read('methods.json'), links: read('nutrition-links.json'),
    candidates: read('cn6-candidate-links.json'), cn6: read('cn6-foods.json'),
    observations: read('nutrition-observations.json'), index: read('search-index.json'),
  };
}

export function createServer(data, { authUrl = 'http://api:9090/api/v1/auth/me', fetcher = fetch } = {}) {
  const html = readFileSync(new URL('./index.html', import.meta.url));
  const script = readFileSync(new URL('./app.js', import.meta.url));
  const norm = s => s.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    const send = (status, value) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method !== 'GET') return send(405, { error:'只读接口' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return send(200, { status:'ok', version:data.summary.version });
      if (url.pathname === '/data-lab' || url.pathname === '/data-lab/') {
        res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); return res.end(html);
      }
      if (url.pathname === '/data-lab/app.js') {
        res.writeHead(200, { 'Content-Type':'text/javascript; charset=utf-8' }); return res.end(script);
      }
      if (!url.pathname.startsWith('/data-lab/api/')) return send(404, {error:'不存在'});
      const authorization = req.headers.authorization;
      if (!authorization || !/^Bearer \S{1,8192}$/.test(authorization)) return send(401, {error:'请先登录管理后台'});
      let auth;
      try { auth = await fetcher(authUrl, {headers:{ authorization, 'x-forwarded-proto':'https' }, signal:AbortSignal.timeout(5000), redirect:'error'}); }
      catch { return send(503, {error:'登录验证服务暂不可用'}); }
      if (!auth.ok) return send(auth.status >= 500 ? 503 : 401, {error:'管理员会话已失效'});
      const user = await auth.json();
      if (user.role !== 'admin') return send(403, {error:'仅管理员可访问'});
      if (user.must_change_password) return send(403, {error:'请先在后台修改初始密码'});
      if (url.pathname === '/data-lab/api/summary') return send(200, data.summary);
      if (url.pathname === '/data-lab/api/concepts') {
        const q = norm((url.searchParams.get('q') || '').slice(0, 100));
        const kind = url.searchParams.get('kind');
        const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get('offset')) || 0));
        const candidates = new Set((data.index[q] || []).map(x => x.concept_id));
        const rows = data.concepts.filter(c => c.active_catalogue && (!kind || c.kind === kind || c.application_roles?.includes(kind)) &&
          (!q || candidates.has(c.id) || norm(c.name_zh).includes(q)));
        return send(200, {total:rows.length, items:rows.slice(offset, offset+40).map(c=>({id:c.id,name:c.name_zh,kind:c.kind}))});
      }
      if (url.pathname === '/data-lab/api/concept') {
        const id = url.searchParams.get('id');
        const concept = data.concepts.find(c=>c.id===id);
        if (!concept) return send(404, {error:'概念不存在'});
        const forms = data.forms.filter(f=>f.concept_id===id);
        const recipe = data.recipes.find(r=>r.dish_concept_id===id) || null;
        return send(200, {concept,forms,recipe, methods:recipe ? data.methods.filter(m=>recipe.method_ids.includes(m.id)) : [],
          nutrition_links:data.links.filter(l=>l.ingredient_concept_id===id),
          cn6_candidates:data.candidates.filter(l=>l.ingredient_concept_id===id)});
      }
      if (url.pathname === '/data-lab/api/nutrition') {
        const id=url.searchParams.get('id');
        if (id?.startsWith('CN6:')) {
          const record=data.cn6.find(r=>r.id===id);
          return record ? send(200,{source:'CN6',status:'候选来源，尚不能自动计算',record}) : send(404,{error:'来源不存在'});
        }
        const rows=data.observations.filter(r=>r.food_id===id);
        return rows.length ? send(200,{source:'TFDA',status:'需确认食材形态及重量基准',observations:rows}) : send(404,{error:'来源不存在'});
      }
      return send(404,{error:'不存在'});
    } catch { return send(500,{error:'数据读取失败'}); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data=loadData(process.env.DATA_ROOT || '/data');
  createServer(data).listen(Number(process.env.PORT || 9091),'0.0.0.0',()=>console.log(JSON.stringify({service:'concept-data',version:data.summary.version,ready:true})));
}
