import { describe, expect, it } from 'vitest'
import {
  assertModelBindingPreservesRequest,
  MagpieGatewayAdapter,
  createPassthroughModelAccessAdapter,
  enforceModelAccessBoundary,
  type ModelAccessRequest,
  type ModelBinding,
} from '../../packages/ekko-agent/src/index'

const request: ModelAccessRequest = {
  sessionId: 'session-1',
  agentId: 'opencode',
  routeId: 'codex',
}

describe('Ekko Magpie route boundary', () => {
  it.each([
    ['opencode', 'codex'],
    ['opencode', 'claude'],
    ['hermes', 'codex'],
    ['hermes', 'claude'],
  ] as const)('preserves %s -> %s without an explicit model', async (agentId, routeId) => {
    const adapter = enforceModelAccessBoundary(createPassthroughModelAccessAdapter())
    const intent: ModelAccessRequest = { ...request, agentId, routeId }

    await expect(adapter.bind(intent)).resolves.toEqual(intent)
  })

  it('preserves an explicitly supplied model', async () => {
    const adapter = enforceModelAccessBoundary(createPassthroughModelAccessAdapter())
    const intent = { ...request, modelId: 'model-1' }

    await expect(adapter.bind(intent)).resolves.toEqual(intent)
  })

  it('allows a gateway model when no model was explicitly supplied', async () => {
    const adapter = enforceModelAccessBoundary({
      async bind(input) {
        return { ...input, modelId: 'route-default-model' }
      },
    })

    await expect(adapter.bind(request)).resolves.toEqual({ ...request, modelId: 'route-default-model' })
  })

  it.each([
    ['sessionId', { sessionId: 'other-session' }],
    ['agentId', { agentId: 'hermes' }],
    ['routeId', { routeId: 'claude' }],
    ['modelId', { modelId: 'other-model' }],
    ['modelId', { modelId: undefined }],
  ] satisfies [string, Partial<ModelBinding>][])('rejects substituted or dropped %s', async (key, change) => {
    const intent = { ...request, modelId: 'model-1' }
    const binding = { ...intent, ...change }
    const adapter = enforceModelAccessBoundary({
      async bind() {
        return binding
      },
    })

    expect(() => assertModelBindingPreservesRequest(intent, binding)).toThrow(`substituted ${key}`)
    await expect(adapter.bind(intent)).rejects.toThrow(`substituted ${key}`)
  })

  it('rejects an explicit model omitted from the binding', async () => {
    const adapter = enforceModelAccessBoundary({
      async bind({ modelId: _modelId, ...input }) {
        return input
      },
    })

    await expect(adapter.bind({ ...request, modelId: 'model-1' })).rejects.toThrow('substituted modelId')
  })

  it('uses native TokenFor caller identity and preserves session identity for codex', async () => {
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3425/v1/responses')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer magpie-opencode')
      expect(headers.get('x-magpie-session')).toBe('session-1')
      expect(headers.has('x-magpie-agent')).toBe(false)
      return new Response(JSON.stringify({ id: 'response-1', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 })
    }
    const adapter = new MagpieGatewayAdapter({ ...request, modelId: 'codex-model' }, { fetch: fetchImpl })

    await adapter.create({ messages: [{ role: 'user', content: 'hello' }] })
  })

  it('routes claude through Anthropic Messages and fails closed without a model', () => {
    expect(() => new MagpieGatewayAdapter({ ...request, routeId: 'claude' })).toThrow('no default model')
    const adapter = new MagpieGatewayAdapter({ ...request, routeId: 'claude', modelId: 'claude-model' })
    expect(adapter.requestStyle).toBe('anthropic-messages')
    expect(adapter.requestTarget()).toBe('http://127.0.0.1:3425/v1/messages')
  })

  it('rejects substitution through input mutation and leaves the caller intent intact', async () => {
    const intent = { ...request }
    const adapter = enforceModelAccessBoundary({
      async bind(input) {
        return Object.assign(input, { routeId: 'claude' as const })
      },
    })

    await expect(adapter.bind(intent)).rejects.toThrow('substituted routeId')
    expect(intent).toEqual(request)
  })
})
