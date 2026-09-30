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

import { AnthropicMessagesModelClient } from './providers/anthropic'
import { OpenAIResponsesModelClient } from './providers/openai-responses'
import type { ModelClient, ModelClientOptions, ModelEvent, ModelRequest, ModelResponse } from './types'

export interface ModelAccessAdapter {
  bind(request: ModelAccessRequest): Promise<ModelBinding>
}

export interface MagpieGatewayAdapterOptions extends ModelClientOptions {
  readonly baseUrl?: string
  readonly defaultModel?: string
}

/**
 * Native Magpie gateway client. The gateway identifies the caller through its
 * TokenFor contract (Bearer magpie-<agent>), while X-Magpie-Session carries
 * session affinity. No legacy X-Magpie-Agent header is sent.
 */
export class MagpieGatewayAdapter implements ModelAccessAdapter, ModelClient {
  readonly provider: string
  readonly requestStyle: 'openai-responses' | 'anthropic-messages'
  readonly capabilities: ModelClient['capabilities']

  private readonly request: ModelAccessRequest
  private readonly client: ModelClient

  constructor(request: ModelAccessRequest, options: MagpieGatewayAdapterOptions = {}) {
    this.request = { ...request }
    const model = request.modelId ?? options.defaultModel
    if (!model) throw new Error(`Magpie gateway has no default model for ${request.routeId}`)

    const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:3425').replace(/\/+$/, '')
    const headers = {
      authorization: `Bearer magpie-${request.agentId}`,
      'X-Magpie-Session': request.sessionId,
    }
    const config = {
      id: `magpie-${request.routeId}`,
      type: request.routeId === 'claude' ? 'anthropic' as const : 'openai' as const,
      requestStyle: request.routeId === 'claude' ? 'anthropic-messages' as const : 'openai-responses' as const,
      endpointPath: request.routeId === 'claude' ? 'v1/messages' : 'v1/responses',
      baseUrl,
      defaultModel: model,
      headers,
    }
    const clientOptions: ModelClientOptions = { fetch: options.fetch }
    this.client = request.routeId === 'claude'
      ? new AnthropicMessagesModelClient(config, clientOptions)
      : new OpenAIResponsesModelClient(config, clientOptions)
    this.provider = this.client.provider
    this.requestStyle = request.routeId === 'claude' ? 'anthropic-messages' : 'openai-responses'
    this.capabilities = this.client.capabilities
  }

  async bind(): Promise<ModelBinding> {
    return { ...this.request }
  }

  create(request: ModelRequest): Promise<ModelResponse> {
    return this.client.create({ ...request, model: request.model ?? this.request.modelId })
  }

  stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    return this.client.stream({ ...request, model: request.model ?? this.request.modelId })
  }

  requestTarget(request?: ModelRequest): string {
    return this.client.requestTarget?.(request ?? { messages: [] }) ?? ''
  }
}

export function createMagpieGatewayAdapter(
  request: ModelAccessRequest,
  options: MagpieGatewayAdapterOptions = {},
): MagpieGatewayAdapter {
  return new MagpieGatewayAdapter(request, options)
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
