export interface ModelRouteRequest {
  agentId: 'opencode' | 'hermes'
  routeId: 'codex' | 'claude'
  modelId?: string
}
