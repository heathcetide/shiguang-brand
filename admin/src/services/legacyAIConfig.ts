// Editable field allowlist; effective display metadata and stored secrets are never PATCH inputs.
export const legacyTextFields = ['baseUrl', 'model', 'chatBaseUrl', 'chatModel', 'visionBaseUrl', 'visionModel', 'asrBaseUrl', 'asrModel', 'supervisorModel', 'nutritionModel', 'recipeModel', 'operationsModel', 'systemPrompt'] as const;
export function legacyConfigPatch(current: Record<string, unknown>, initial: Record<string, unknown>, credentials: Record<string, string>, clear: string[] = []) {
  const patch: Record<string, unknown> = {};
  for (const field of [...legacyTextFields, 'runtimePolicy']) {
    if (JSON.stringify(current[field]) !== JSON.stringify(initial[field])) patch[field] = current[field];
  }
  for (const field of ['apiKey', 'chatApiKey', 'visionApiKey', 'asrApiKey']) {
    if (credentials[field]?.trim()) patch[field] = credentials[field].trim();
    else if (clear.includes(field)) patch[field] = "";
  }
  return patch;
}
