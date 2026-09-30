import { describe, expect, it } from 'vitest'
import {
  assertModelBindingPreservesRequest,
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
