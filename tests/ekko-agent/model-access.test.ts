import { describe, expect, it } from 'vitest'
import {
  assertModelBindingPreservesRequest,
  createPassthroughModelAccessAdapter,
  enforceModelAccessBoundary,
  type ModelAccessRequest,
} from '../../packages/ekko-agent/src/index'

const request: ModelAccessRequest = {
  sessionId: 'session-1',
  agentId: 'agent-1',
  modelId: 'model-1',
  accountId: 'account-1',
  providerId: 'provider-1',
}

describe('Ekko model access boundary', () => {
  it('preserves explicit agent, model, account, and provider references', async () => {
    const adapter = enforceModelAccessBoundary(createPassthroughModelAccessAdapter())

    await expect(adapter.bind(request)).resolves.toEqual(request)
  })

  it('rejects identity substitution instead of falling back', async () => {
    const adapter = enforceModelAccessBoundary({
      async bind(input) {
        return { ...input, modelId: 'fallback-model' }
      },
    })

    await expect(adapter.bind(request)).rejects.toThrow('substituted modelId')
  })

  it('rejects a binding that omits or changes an explicit reference', () => {
    expect(() => assertModelBindingPreservesRequest(request, {
      ...request,
      providerId: 'other-provider',
    })).toThrow('substituted providerId')
  })
})
