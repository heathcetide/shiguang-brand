import api from './api';
import { UnsupportedResourceConfiguration, assertSupportedConfiguration, writableConfiguration, type ResourceConfiguration, type ResourceUpdate } from './aiResources';
export const resourceEndpoint = '/admin/ai-config/resources';
export async function readResources(signal?: AbortSignal) {
  const data = (await api.get<ResourceConfiguration>(resourceEndpoint, { signal })).data;
  if (!data.lifecycle) throw new UnsupportedResourceConfiguration();
  assertSupportedConfiguration(data); return data;
}
export async function saveResources(data: ResourceUpdate) {
  const result = (await api.put<ResourceConfiguration>(resourceEndpoint, writableConfiguration(data))).data;
  assertSupportedConfiguration(result); return result;
}

export async function draftAction(action: 'test' | 'publish' | 'discard', revision: number, signal?: AbortSignal, service?: string) {
  const result = (await api.post<ResourceConfiguration>(`${resourceEndpoint}/${action}`, { revision, ...(service ? { service } : {}) }, { signal })).data;
  assertSupportedConfiguration(result); return result;
}
