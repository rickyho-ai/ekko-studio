/**
 * Ekko's narrow, provider-neutral Magpie route/gateway contract.
 *
 * Ekko hands its already-selected session, agent, route, and optional model
 * intent to a future Magpie gateway. Account selection, credentials, provider
 * fallback, authentication, and provider endpoints are outside this boundary.
 */
export interface ModelAccessRequest {
  readonly sessionId: string
  readonly agentId: 'opencode' | 'hermes'
  readonly routeId: 'codex' | 'claude'
  readonly modelId?: string
}

export interface ModelBinding extends ModelAccessRequest {}

export interface ModelAccessAdapter {
  bind(request: ModelAccessRequest): Promise<ModelBinding>
}

/**
 * Minimal adapter for the pre-Magpie boundary. It intentionally preserves
 * every explicit reference and has no fallback or provider-specific behavior.
 */
export function createPassthroughModelAccessAdapter(): ModelAccessAdapter {
  return {
    async bind(request): Promise<ModelBinding> {
      return {
        sessionId: request.sessionId,
        agentId: request.agentId,
        routeId: request.routeId,
        ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
      }
    },
  }
}

/**
 * Assert that an access implementation did not replace Ekko's explicit intent.
 */
export function assertModelBindingPreservesRequest(
  request: ModelAccessRequest,
  binding: ModelBinding,
): ModelBinding {
  for (const key of ['sessionId', 'agentId', 'routeId'] as const) {
    if (binding[key] !== request[key]) {
      throw new Error(`Model access adapter substituted ${key}`)
    }
  }
  if (request.modelId !== undefined && binding.modelId !== request.modelId) {
    throw new Error('Model access adapter substituted modelId')
  }
  return binding
}

/**
 * Wrap an implementation while keeping identity-preservation at the Ekko
 * boundary. The wrapped adapter remains responsible only for access binding.
 */
export function enforceModelAccessBoundary(adapter: ModelAccessAdapter): ModelAccessAdapter {
  return {
    async bind(request): Promise<ModelBinding> {
      // Compare against the original intent even if an implementation mutates its input.
      const intent = { ...request }
      const binding = await adapter.bind({ ...intent })
      return assertModelBindingPreservesRequest(intent, binding)
    },
  }
}
