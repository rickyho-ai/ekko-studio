export interface ModelRouteRequest {
  agentId: 'opencode' | 'hermes'
  routeId: 'codex' | 'claude'
  modelId?: string
}

/** Validate and copy user intent without inventing defaults or substituting models. */
export function snapshotModelRoute(value: unknown): ModelRouteRequest | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid modelRoute')
  const route = value as Record<string, unknown>
  if (route.agentId !== 'opencode' && route.agentId !== 'hermes') throw new Error('Invalid modelRoute.agentId')
  if (route.routeId !== 'codex' && route.routeId !== 'claude') throw new Error('Invalid modelRoute.routeId')
  if (Object.hasOwn(route, 'modelId') && typeof route.modelId !== 'string') throw new Error('Invalid modelRoute.modelId')
  return {
    agentId: route.agentId,
    routeId: route.routeId,
    ...(Object.hasOwn(route, 'modelId') ? { modelId: route.modelId as string } : {}),
  }
}
