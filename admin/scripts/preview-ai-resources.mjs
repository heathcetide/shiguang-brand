// Local-only read-only demonstration. All /api requests terminate here; never proxy to a backend.
import { createServer } from 'vite';
const capabilities = ['chat', 'vision', 'asr'];
const ids = [...capabilities, 'supervisor', 'nutrition', 'recipe', 'operations'];
const resources = [
  ...capabilities.map(scope => ({ id: `legacy-${scope}`, name: `旧配置 · ${scope}`, kind: 'legacy', scope })),
  { id: 'demo-primary', name: '演示 · 对话服务', kind: 'connection', protocol: 'openai-compatible', baseUrl: 'https://chat.example.invalid/v1', models: [{ id: 'demo-chat', capabilities: ['chat'] }], hasApiKey: true, verification: 'unverified' },
  { id: 'demo-media', name: '演示 · 多模态服务', kind: 'connection', protocol: 'openai-compatible', baseUrl: 'https://media.example.invalid/v1', models: [{ id: 'demo-vision', capabilities: ['vision'] }, { id: 'demo-asr', capabilities: ['asr'] }], hasApiKey: false, verification: 'unverified' },
];
resources.push({ id: 'demo-web', name: '演示 · DeepSeek 搜索工具', kind: 'tool', protocol: 'deepseek-tools', baseUrl: 'https://api.deepseek.com', tools: ['search', 'fetch'], hasApiKey: true, verification: 'unverified' });
const defaults = Object.fromEntries(capabilities.map(c => [c, { resourceId: c === 'chat' ? 'demo-primary' : 'demo-media', model: `demo-${c}` }]));
const fixture = { schemaVersion: 1, revision: 7, migrated: true, resources, defaults,
  services: Object.fromEntries(ids.map(id => [id, id === 'vision' ? defaults.vision : { inherit: true }])),
  catalog: ids.map(id => ({ id, capability: capabilities.includes(id) ? id : 'chat', input: id === 'vision' ? 'image-and-prompt' : id === 'asr' ? 'audio' : 'messages', output: id === 'asr' ? 'transcript' : 'chat-completion' })),
  effective: Object.fromEntries(ids.map(id => { const c = capabilities.includes(id) ? id : 'chat'; return [id, { ...defaults[c], baseUrl: c === 'chat' ? resources[3].baseUrl : resources[4].baseUrl, hasApiKey: c === 'chat', source: id === 'vision' ? 'service:vision' : c === 'chat' && id !== 'chat' ? 'service:chat' : `default:${c}` }]; })),
};
fixture.defaults.search = { resourceId: 'demo-web' };
fixture.services.search = { inherit: true };
fixture.services.fetch = { resourceId: 'demo-web' };
fixture.catalog.push(...['search', 'fetch'].map(id => ({ id, kind: 'tool', capability: id, input: id === 'search' ? 'public-query' : 'public-url', output: 'untrusted-web-results', automaticExecution: false })));
fixture.effective.search = { status: 'unverified', source: 'default:search', resourceId: 'demo-web', hasApiKey: true };
fixture.effective.fetch = { status: 'disabled', resourceId: 'demo-web', reason: 'redirect-safety-unavailable' };
const server = await createServer({ server: { host: '127.0.0.1', port: 5186, strictPort: true }, plugins: [{
  name: 'local-ai-demo',
  transformIndexHtml() { return [{ tag: 'script', children: "localStorage.setItem('adminToken','local-demo-not-a-real-token')", injectTo: 'head-prepend' }]; },
  configureServer(server) { server.middlewares.use((req, res, next) => {
    if (!req.url.startsWith('/api/')) return next();
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: '只读演示' })); }
    if (req.url === '/api/v1/auth/me') return res.end(JSON.stringify({ role: 'admin', username: '本地演示' }));
    if (req.url === '/api/v1/admin/ai-config/resources') return res.end(JSON.stringify(fixture));
    res.statusCode = 404; res.end('{}');
  }); },
}] });
await server.listen(); server.printUrls();
