import { request } from '../client'

export interface ModelRouteRequest {
  agentId: 'opencode' | 'hermes'
  routeId: 'codex' | 'claude'
  modelId?: string
}

export async function fetchModelRouteModels(signal?: AbortSignal): Promise<string[]> {
  const catalog = await request<{ models: string[] }>('/api/studio/chat-run/model-route/models', { signal })
  if (!Array.isArray(catalog.models) || catalog.models.some(id => typeof id !== 'string')) {
    throw new Error('Invalid model route catalog')
  }
  return catalog.models
}
