import { createLatestRequest } from "../utils/latestRequest";
import { legacyConfigPatch } from "../services/legacyAIConfig";
import { useEffect, useRef, useState } from "react";
import { Bot, Key, Globe, Cpu, Zap, Save, CheckCircle2, AlertCircle, RefreshCw, Mic, SlidersHorizontal, Image } from "lucide-react";
import api from "../services/api";

const PROVIDER_PRESETS = [
  {
    name: "硅基流动 (SiliconFlow)",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    visionModel: "Qwen/Qwen2.5-VL-72B-Instruct",
    asrModel: "FunAudioLLM/SenseVoiceSmall",
    desc: "文本与多模态接口；能力需逐项验证。",
  },
  {
    name: "阿里云百炼 (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-max",
    visionModel: "qwen-vl-max",
    asrModel: "sensevoice-v1",
    desc: "兼容接口；模型能力需逐项验证。",
  },
  {
    name: "DeepSeek 官方 API",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    visionModel: "deepseek-chat",
    asrModel: "FunAudioLLM/SenseVoiceSmall",
    desc: "文本接口；不表示支持视觉或 ASR。",
  },
  {
    name: "OpenAI 官方 API",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    visionModel: "gpt-4o-mini",
    asrModel: "whisper-1",
    desc: "文本、视觉及 ASR 接口；能力需逐项验证。",
  },
];

const sectionTitleClass = "text-base font-bold text-text-main flex items-center gap-2";
const modelGridClass = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3";
const sectionHeaderClass = "flex items-center justify-between pb-3 border-b border-gray-100";
const hintBadgeClass = "text-xs text-text-muted bg-background-alt px-2.5 py-1 rounded-lg";
const fieldLabelClass = "block text-xs font-semibold text-text-main mb-1 flex items-center gap-1";
const modelLabelClass = "text-[11px] font-semibold text-text-main";
const modelInputClass = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-mono";

const rowClass = "flex items-center justify-between";

const mutedClass = "text-xs text-text-muted";

const policyInputClass = "w-full border rounded p-2";

export default function AIConfig() {
  // 全局默认配置
  const [apiKey, setApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.siliconflow.cn/v1");

  // 独立服务接入开关
  const [enablePerServiceProviders, setEnablePerServiceProviders] = useState(false);

  // 文本对话服务配置
  const [chatApiKey, setChatApiKey] = useState("");
  const [chatMaskedKey, setChatMaskedKey] = useState("");
  const [hasChatApiKey, setHasChatApiKey] = useState(false);
  const [chatBaseUrl, setChatBaseUrl] = useState("");
  const [model, setModel] = useState("deepseek-ai/DeepSeek-V3");
  const [effectiveModels, setEffectiveModels] = useState<Array<{ role: string; model: string; source: string; baseUrl: string }>>([]);
  const [runtimePolicy, setRuntimePolicy] = useState({
    main: { thinking: "default", maxTokens: 3000, timeoutMs: 60000, retries: 0 },
    planner: { thinking: "default", maxTokens: 3000, timeoutMs: 60000, retries: 0 },
    vision: { thinking: "default", maxTokens: 3000, timeoutMs: 60000, retries: 0 },
    asr: { thinking: "default", maxTokens: 3000, timeoutMs: 60000, retries: 0 },
    deadlineMs: 180000, maxModelCalls: 12, maxToolCalls: 6,
  });
  const [supervisorModel, setSupervisorModel] = useState("deepseek-ai/DeepSeek-V3");
  const [nutritionModel, setNutritionModel] = useState("deepseek-ai/DeepSeek-V3");
  const [recipeModel, setRecipeModel] = useState("deepseek-ai/DeepSeek-V3");
  const [operationsModel, setOperationsModel] = useState("deepseek-ai/DeepSeek-V3");

  // 多模态识图服务配置
  const [visionApiKey, setVisionApiKey] = useState("");
  const [visionMaskedKey, setVisionMaskedKey] = useState("");
  const [hasVisionApiKey, setHasVisionApiKey] = useState(false);
  const [visionBaseUrl, setVisionBaseUrl] = useState("");
  const [visionModel, setVisionModel] = useState("Qwen/Qwen2.5-VL-72B-Instruct");

  // 语音识别 ASR 服务配置
  const [asrApiKey, setAsrApiKey] = useState("");
  const [asrMaskedKey, setAsrMaskedKey] = useState("");
  const [hasAsrApiKey, setHasAsrApiKey] = useState(false);
  const [asrBaseUrl, setAsrBaseUrl] = useState("");
  const [asrModel, setAsrModel] = useState("FunAudioLLM/SenseVoiceSmall");

  // 人设提示词
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSystemPromptCustomized, setIsSystemPromptCustomized] = useState(false);

  // UI 状态
  const reads = useRef(createLatestRequest());
  const lifecycle = useRef(0), testBusy = useRef(false);
  const draftRevision = useRef(0);
  const initial = useRef<Record<string, unknown>>({});
  const saveBusy = useRef(false);
  const [clearKeys, setClearKeys] = useState<string[]>([]);
  const [storedKeys, setStoredKeys] = useState<Record<string, boolean>>({});
  const [needsReload, setNeedsReload] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency?: number } | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const fetchConfig = async () => {
    const owner = lifecycle.current, request = reads.current.begin();
    try {
      setLoading(true);
      const { data } = await api.get("/admin/ai-config", { signal: request.signal });

      if (owner !== lifecycle.current || !request.isLatest()) return;
      if (!data.editable || !Number.isSafeInteger(data.draftRevision)) throw new Error('Editable configuration unavailable');
      draftRevision.current = data.draftRevision;
      const fields = data.editable;
      const displayedModel = fields.chatModel || fields.model || '';
      initial.current = { ...fields, model: displayedModel, chatModel: displayedModel, runtimePolicy: data.runtimePolicy };
      setEffectiveModels(data.effectiveModels || []);
      setApiKey(''); setChatApiKey(''); setVisionApiKey(''); setAsrApiKey('');
      setBaseUrl(fields.baseUrl); setModel(displayedModel); setVisionModel(fields.visionModel); setAsrModel(fields.asrModel);
      setChatBaseUrl(fields.chatBaseUrl); setVisionBaseUrl(fields.visionBaseUrl); setAsrBaseUrl(fields.asrBaseUrl);
      setSupervisorModel(fields.supervisorModel); setNutritionModel(fields.nutritionModel);
      setRecipeModel(fields.recipeModel); setOperationsModel(fields.operationsModel);
      setSystemPrompt(fields.systemPrompt); setIsSystemPromptCustomized(!!fields.systemPrompt);
      setRuntimePolicy(data.runtimePolicy);
      const keys = data.credentialState;
      setStoredKeys({ apiKey: keys.global, chatApiKey: keys.chat, visionApiKey: keys.vision, asrApiKey: keys.asr }); setClearKeys([]);
      setHasApiKey(!!data.hasApiKey); setHasChatApiKey(!!keys.chat); setHasVisionApiKey(!!keys.vision); setHasAsrApiKey(!!keys.asr);
      setMaskedKey(data.hasApiKey ? '********' : ''); setChatMaskedKey(keys.chat ? '********' : '');
      setVisionMaskedKey(keys.vision ? '********' : ''); setAsrMaskedKey(keys.asr ? '********' : '');
      setEnablePerServiceProviders(!!(keys.chat || keys.vision || keys.asr || fields.chatBaseUrl || fields.visionBaseUrl || fields.asrBaseUrl));
      setLoadError(false); setNeedsReload(false);
    } catch {
      if (owner !== lifecycle.current || !request.isLatest()) return;
      setLoadError(true);
    } finally {
      if (owner === lifecycle.current && request.isLatest()) setLoading(false);
    }
  };

  useEffect(() => {
    const owner = lifecycle, pendingReads = reads.current;
    fetchConfig();
    return () => { owner.current++; pendingReads.cancel(); };
  }, []);

  const handleApplyPreset = (preset: (typeof PROVIDER_PRESETS)[0]) => {
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setSupervisorModel(preset.model);
    setNutritionModel(preset.model);
    setRecipeModel(preset.model);
    setOperationsModel(preset.model);
    setVisionModel(preset.visionModel);
    if (preset.asrModel) setAsrModel(preset.asrModel);
    setStatusMsg(`已应用【${preset.name}】的基准配置，请输入该平台的 API Key`);
    setTimeout(() => setStatusMsg(""), 3500);
  };

  const editKey = (set: (value: string) => void, key: string, value: string) => {
    set(value);
    if (value.trim()) setClearKeys(current => current.filter(item => item !== key));
  };

  const handleSave = async () => {
    if (saveBusy.current || loadError || needsReload) return;
    const patch = legacyConfigPatch({ baseUrl, model, chatModel: model, visionModel, asrModel,
      supervisorModel, nutritionModel, recipeModel, operationsModel, chatBaseUrl, visionBaseUrl, asrBaseUrl,
      systemPrompt, runtimePolicy }, initial.current, { apiKey, chatApiKey, visionApiKey, asrApiKey }, clearKeys);
    if (!Object.keys(patch).length) { setStatusMsg('没有需要保存的修改。'); return; }
    if (clearKeys.length && !window.confirm("确定清除所选数据库密钥覆盖？已有全局或环境凭据仍按旧配置规则回退。")) return;
    saveBusy.current = true;
    const owner = lifecycle.current;
    try {
      setSaving(true);
      await api.put('/admin/ai-config', { ...patch, draftRevision: draftRevision.current });
      if (owner !== lifecycle.current) return;
      await fetchConfig();
      if (owner !== lifecycle.current) return;
      setStatusMsg("草稿已保存，请到业务服务页测试并发布。");
      setIsSystemPromptCustomized(true);
      setTimeout(() => setStatusMsg(""), 4000);
    } catch {
      if (owner !== lifecycle.current) return;
      setNeedsReload(true);
    } finally {
      if (owner === lifecycle.current) { saveBusy.current = false; setSaving(false); }
    }
  };

  const handleTestConnection = async () => {
    if (testBusy.current || saveBusy.current || needsReload || loadError) return;
    testBusy.current = true;
    const owner = lifecycle.current, revision = draftRevision.current;
    try {
      setTesting(true);
      setTestResult(null);

      const { data } = await api.post("/admin/ai-config/resources/test", { revision });
      if (owner !== lifecycle.current) return;
      setTestResult({ success: !!data.lifecycle?.test?.success, message: `草稿版本 ${revision} 配置校验；未调用供应商，不验证生产能力。` });
    } catch {
      if (owner !== lifecycle.current) return;
      setTestResult({
        success: false,
        message: "校验未确认，请重新读取草稿版本。",
      });
    } finally {
      if (owner === lifecycle.current) { testBusy.current = false; setTesting(false); }
    }
  };

  if (loadError) return <div role="alert">无法读取原始可编辑配置，已停止编辑。<button onClick={() => void fetchConfig()}>重新读取</button></div>;
  if (loading) return <div className="text-center py-20 text-text-muted">加载 AI 服务配置中...</div>;

  return (
    <div className="space-y-6" onChangeCapture={() => setTestResult(null)}>
      {needsReload && <div role="alert">保存未确认，请重新读取核对；不会自动重试。<button onClick={() => void fetchConfig()}>重新读取</button></div>}
      <fieldset disabled={saving || testing || needsReload} className="contents">
      <div className={rowClass}>
        <div>
          <h2 className="text-2xl font-bold text-text-main flex items-center gap-2">
            <Bot className="text-primary" size={28} /> 旧配置与策略
          </h2>
          <p className="text-sm text-text-muted mt-1">
            兼容入口：保留原配置、角色模型、提示词与调用预算。新连接和业务绑定请使用「服务提供商」「业务服务」。保存仅更新草稿，请到业务服务页测试并发布。
          </p>
        </div>
      </div>

      {statusMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-2xl flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 size={18} />
          {statusMsg}
        </div>
      )}

      {/* 快捷配置推荐卡片 */}
      <div className="bg-white p-6 rounded-[24px] shadow-sm space-y-4">
        <h3 className={sectionTitleClass}>
          <Zap className="text-yellow-500" size={18} /> 一键应用推荐服务商
        </h3>
        <div className={modelGridClass}>
          {PROVIDER_PRESETS.map((preset, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleApplyPreset(preset)}
              className="text-left p-4 rounded-2xl border border-gray-100 bg-background-alt hover:border-primary hover:bg-green-50/50 transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="font-bold text-sm text-text-main group-hover:text-primary">{preset.name}</div>
                <div className="text-xs text-text-muted mt-1 leading-relaxed">{preset.desc}</div>
              </div>
              <div className="text-[10px] text-gray-400 font-mono mt-3 truncate">Base: {preset.baseUrl}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 配置表单 */}
      <div className="bg-white p-6 rounded-[24px] shadow-sm space-y-6">
        {/* 1. 默认全局共享接入点 */}
        <div className="space-y-4">
          <div className={sectionHeaderClass}>
            <h3 className={sectionTitleClass}>
              <Globe className="text-primary" size={18} /> 1. 全局默认共享服务接入点 (Fallback Provider)
            </h3>
            <span className={hintBadgeClass}>
              当子服务未指定独立接入点时，自动使用此配置
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={fieldLabelClass}>
                <Key size={14} className="text-primary" /> 全局默认 API Key
              </label>
              <div className="relative flex items-center">
                <input
                  type={showKeys ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => editKey(setApiKey, "apiKey", e.target.value)}
                  placeholder={hasApiKey ? `${maskedKey}（留空保持不变）` : "请输入全局 API Key"}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-primary text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKeys(!showKeys)}
                  className="absolute right-3 text-xs text-text-muted hover:text-text-main font-medium"
                >
                  {showKeys ? "隐藏" : "显示"}
                </button>
              </div>
            </div>

            <div>
              <label className={fieldLabelClass}>
                <Globe size={14} className="text-primary" /> 全局默认 API Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.siliconflow.cn/v1"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-primary text-xs font-mono"
              />
            </div>
          </div>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="font-semibold">调用策略与预算</h2>
          <div className="grid gap-2 text-xs text-gray-600">{effectiveModels.map((entry) => <div key={entry.role}><strong>{entry.role}草稿解析：</strong>{entry.model}（{entry.source}）<div className="break-all">接入点：{entry.baseUrl}</div></div>)}</div>
          <p className="text-xs text-amber-700">连接成功不证明工具、结构化输出、流式或媒体能力可用。</p>
          <p className={mutedClass}>已保存的草稿策略；不支持的思考参数会拒绝保存。输出长度不等于思考预算。</p>
          {(["main", "planner", "vision", "asr"] as const).map((role) => (
            <div key={role} className="grid grid-cols-4 gap-2">
              <label>{ { main: "主助手", planner: "复杂规划", vision: "图片识别", asr: "语音转写" }[role] }
                <select aria-label={`${role} 思考模式`} value={runtimePolicy[role].thinking} onChange={(event) => setRuntimePolicy((value) => ({ ...value, [role]: { ...value[role], thinking: event.target.value } }))} className={policyInputClass}>
                  <option value="default">提供商默认</option>
                  {role !== "asr" && (() => {
                    const roles = role === "main" ? ["对话", "主助手", "菜谱", "运营"] : role === "planner" ? ["规划"] : ["图片"];
                    const supported = roles.every(name => effectiveModels.some(entry => entry.role === name && /^https:\/\/api\.siliconflow\.(cn|com)(\/|$)/.test(entry.baseUrl) && ["Pro/deepseek-ai/DeepSeek-V4", "deepseek-ai/DeepSeek-V4-Flash", "Pro/zai-org/GLM-5.2", "deepseek-ai/DeepSeek-R1", "deepseek-ai/DeepSeek-V3", "Pro/deepseek-ai/DeepSeek-R1", "Pro/deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B", "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", "deepseek-ai/DeepSeek-R1-Distill-Llama-70B"].includes(entry.model)));
                    const effortSupported = roles.every(name => effectiveModels.some(entry => entry.role === name && /^https:\/\/api\.siliconflow\.(cn|com)(\/|$)/.test(entry.baseUrl) && ["Pro/deepseek-ai/DeepSeek-V4", "deepseek-ai/DeepSeek-V4-Flash", "Pro/zai-org/GLM-5.2"].includes(entry.model)));
                    return (
                      <>
                        {supported && <option value="off">关闭</option>}
                        {effortSupported ? (
                          <>
                            <option value="high">高强度</option>
                            <option value="max">最大强度</option>
                          </>
                        ) : (runtimePolicy[role].thinking === "high" || runtimePolicy[role].thinking === "max") ? (
                          <option value={runtimePolicy[role].thinking} disabled>当前强度不受此模型支持，请改为提供商默认</option>
                        ) : null}
                      </>
                    );
                  })()}
                </select>
              </label>
              {((role === "asr" ? ["timeoutMs", "retries"] : ["maxTokens", "timeoutMs", "retries"]) as Array<"maxTokens" | "timeoutMs" | "retries">).map((field) => <label key={field} className="text-xs">{{ maxTokens: "输出 token 上限", timeoutMs: "单次超时（毫秒）", retries: "瞬时错误重试次数" }[field]}<input type="number" value={runtimePolicy[role][field]} onChange={(event) => setRuntimePolicy((value) => ({ ...value, [role]: { ...value[role], [field]: Number(event.target.value) } }))} className={policyInputClass} /></label>)}
            </div>
          ))}
          <div className="grid grid-cols-3 gap-2">{(["deadlineMs", "maxModelCalls", "maxToolCalls"] as const).map((field) => <label key={field} className="text-xs">{{ deadlineMs: "整轮截止时间（毫秒）", maxModelCalls: "总模型调用上限", maxToolCalls: "工具调用上限" }[field]}<input type="number" value={runtimePolicy[field]} onChange={(event) => setRuntimePolicy((value) => ({ ...value, [field]: Number(event.target.value) }))} className={policyInputClass} /></label>)}</div>
        </section>

        {/* 2. Supervisor Runtime 模型 */}
        <div className="space-y-4 pt-2">
          <div className={sectionHeaderClass}>
            <h3 className={sectionTitleClass}>
              <Bot className="text-primary" size={18} /> 2. 主助手与按需规划
            </h3>
            <span className={hintBadgeClass}>留空策略由服务端继承 Chat Model</span>
          </div>
          <p className={mutedClass}>主助手处理问答，按需规划；首页推荐独立。旧文本角色默认继承聊天接入点，视觉和语音使用独立接入点。</p>
          <div className={modelGridClass}>
            {[
              { label: '主助手（兼容 Supervisor 配置）', value: supervisorModel, set: setSupervisorModel },
              { label: '复杂规划（Nutrition）', value: nutritionModel, set: setNutritionModel },
              { label: 'Recipe Cooking', value: recipeModel, set: setRecipeModel },
              { label: 'Operations', value: operationsModel, set: setOperationsModel },
            ].map(field => <label key={field.label} className={modelLabelClass}>{field.label}
              <input value={field.value} onChange={event => field.set(event.target.value)} className={modelInputClass} />
            </label>)}
          </div>
        </div>

        {/* 3. 各能力模型配置 */}
        <div className="space-y-4 pt-2">
          <div className={sectionHeaderClass}>
            <h3 className={sectionTitleClass}>
              <Cpu className="text-secondary" size={18} /> 3. 各 AI 服务能力模型名称与独立接入点
            </h3>

            <button
              type="button"
              onClick={() => setEnablePerServiceProviders(!enablePerServiceProviders)}
              className={`text-xs px-3 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 transition-colors ${
                enablePerServiceProviders
                  ? "bg-primary/10 border-primary text-primary font-bold"
                  : "bg-background-alt border-gray-200 text-text-muted hover:text-text-main"
              }`}
            >
              <SlidersHorizontal size={14} />
              {enablePerServiceProviders ? "独立接入点已展开 (点击折叠)" : "展开独立接入点（折叠不清除设置）"}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {[
              { id: 'chat', title: '文本对话服务', description: 'Chat / Agent', Icon: Bot, color: 'text-primary', modelLabel: 'Chat', modelValue: model, setModelValue: setModel, modelPlaceholder: 'deepseek-ai/DeepSeek-V3', url: chatBaseUrl, setUrl: setChatBaseUrl, urlPlaceholder: 'api.deepseek.com', keyValue: chatApiKey, setKey: setChatApiKey, keyName: 'chatApiKey', keyConfigured: hasChatApiKey, maskedKey: chatMaskedKey },
              { id: 'vision', title: '多模态识图服务', description: 'Vision / OCR', Icon: Image, color: 'text-secondary', modelLabel: 'Vision', modelValue: visionModel, setModelValue: setVisionModel, modelPlaceholder: 'Qwen/Qwen2.5-VL-72B-Instruct', url: visionBaseUrl, setUrl: setVisionBaseUrl, urlPlaceholder: 'dashscope.aliyuncs.com', keyValue: visionApiKey, setKey: setVisionApiKey, keyName: 'visionApiKey', keyConfigured: hasVisionApiKey, maskedKey: visionMaskedKey },
              { id: 'asr', title: '语音识别服务', description: 'ASR / Whisper', Icon: Mic, color: 'text-orange-500', modelLabel: 'ASR', modelValue: asrModel, setModelValue: setAsrModel, modelPlaceholder: 'FunAudioLLM/SenseVoiceSmall', url: asrBaseUrl, setUrl: setAsrBaseUrl, urlPlaceholder: 'api.openai.com', keyValue: asrApiKey, setKey: setAsrApiKey, keyName: 'asrApiKey', keyConfigured: hasAsrApiKey, maskedKey: asrMaskedKey },
            ].map(service => <div key={service.id} className="p-4 rounded-2xl border border-gray-100 bg-background-alt/50 space-y-3">
              <div className={rowClass}>
                <span className="text-xs font-bold text-text-main flex items-center gap-1.5"><service.Icon size={16} className={service.color} aria-hidden="true" /> {service.title}</span>
                <span className="text-[10px] text-text-muted">{service.description}</span>
              </div>
              <div><label className="block text-[11px] text-text-muted mb-1">模型名称 ({service.modelLabel} Model)</label>
                <input type="text" value={service.modelValue} onChange={e => service.setModelValue(e.target.value)} placeholder={service.modelPlaceholder} className="w-full px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-xs font-mono bg-white" />
              </div>
              {enablePerServiceProviders && <div className="pt-2 border-t border-gray-200/60 space-y-2">
                <span className={`text-[10px] ${service.color} font-bold block`}>地址留空继承全局；密钥留空保留已有值</span>
                <div><input type="text" value={service.url} onChange={e => service.setUrl(e.target.value)} placeholder={`专有 Base URL (如 ${service.urlPlaceholder})`} className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] font-mono bg-white" /></div>
                <div><input type={showKeys ? 'text' : 'password'} value={service.keyValue} onChange={e => editKey(service.setKey, service.keyName, e.target.value)} placeholder={service.keyConfigured ? `专有 Key: ${service.maskedKey}` : '专有 API Key (留空保持不变)'} className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] bg-white" /></div>
              </div>}
            </div>)}
          </div>
        </div>

        {/* 3. 人设提示词 */}
        <div className="pt-2 space-y-2">
          <label className="block text-sm font-medium text-text-main flex items-center gap-1.5">
            <Bot size={16} className="text-primary" /> 3. 食语 AI 助手人设系统提示词 (System Prompt)
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            maxLength={12_000}
            placeholder="定义食语的角色、语气、专业边界和服务方式"
            className="w-full resize-y rounded-2xl border border-gray-200 px-4 py-3 font-mono text-xs leading-5 focus:border-primary focus:outline-none"
          />
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{isSystemPromptCustomized ? "正在使用后台自定义人设" : "正在使用系统默认人设"}；用户动态数据与系统规则由后端自动拼接。</span>
            <span>{systemPrompt.length}/12000</span>
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="flex flex-wrap items-center justify-between pt-4 border-t border-gray-100 gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTestConnection()}
              disabled={testing}
              className="px-4 py-2 rounded-xl border border-primary text-primary hover:bg-green-50 font-bold text-xs flex items-center gap-1.5 transition-colors active:scale-95 disabled:opacity-50"
            >
              {testing ? <RefreshCw className="animate-spin" size={14} /> : <Zap size={14} />}
              校验已保存草稿
            </button>

          </div>

          <fieldset disabled={saving} className="text-xs space-y-2">
            <legend>清除已存密钥覆盖（发布后生效）</legend>
            <p>空输入保持不变。清除数据库覆盖后，仍按旧配置规则回退到全局或环境凭据。</p>
            {([['apiKey', '全局'], ['chatApiKey', '对话'], ['visionApiKey', '识图'], ['asrApiKey', '转写']] as const).map(([key, label]) =>
              <label key={key}><input type="checkbox" disabled={!storedKeys[key] || !!({ apiKey, chatApiKey, visionApiKey, asrApiKey } as Record<string, string>)[key].trim()} checked={clearKeys.includes(key)} onChange={event => setClearKeys(current => event.target.checked ? [...current, key] : current.filter(item => item !== key))} />清除{label}密钥覆盖</label>)}
          </fieldset>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-2xl bg-primary text-white hover:bg-primary-dark font-bold text-sm flex items-center gap-2 transition-all active:scale-95 shadow-sm disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "保存中..." : "保存 AI 配置草稿"}
          </button>
        </div>

        {/* 测试结果展示 */}
        {testResult && (
          <div
            className={`p-4 rounded-2xl border ${
              testResult.success ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
            } text-sm flex items-start gap-3`}
          >
            {testResult.success ? <CheckCircle2 size={20} className="mt-0.5" /> : <AlertCircle size={20} className="mt-0.5" />}
            <div>
              <div className="font-bold">
                {testResult.success ? "草稿配置校验通过（未调用供应商）" : "草稿校验失败"}
              </div>
              <div className="mt-1 font-mono text-xs opacity-90">{testResult.message}</div>
            </div>
          </div>
        )}
      </div>
      </fieldset>
    </div>
  );
}
