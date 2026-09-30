/**
 * Ekko's provider-neutral model access contract.
 *
 * Ekko owns the session and requested model intent. An implementation such as
 * Magpie may resolve that intent to an access binding, but it must not invent
 * or silently substitute any of the explicit identities supplied by Ekko.
 */
export interface ModelAccessRequest {
  readonly sessionId: string
  readonly agentId: string
  readonly modelId: string
  readonly accountId: string
  readonly providerId: string
}

export interface ModelBinding {
  readonly sessionId: string
  readonly agentId: string
  readonly modelId: string
  readonly accountId: string
  readonly providerId: string
}

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
      return { ...request }
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
  for (const key of ['sessionId', 'agentId', 'modelId', 'accountId', 'providerId'] as const) {
    if (binding[key] !== request[key]) {
      throw new Error(`Model access adapter substituted ${key}`)
    }
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
      const binding = await adapter.bind(request)
      return assertModelBindingPreservesRequest(request, binding)
    },
  }
}
