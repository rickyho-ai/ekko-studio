import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMagpieModelIds } from '../../packages/server/src/modules/studio/services/chat-run/model-config'

afterEach(() => vi.unstubAllGlobals())

describe('Magpie catalog backend', () => {
  it('fetches the live catalog at the fixed backend URL without credentials or rewriting IDs', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'claude/exact' }, { id: 'codex/exact' }, { id: 'claude/exact' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchMagpieModelIds()).toEqual(['claude/exact', 'codex/exact'])
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3425/v1/models', {
      method: 'GET', signal: expect.any(AbortSignal), redirect: 'error',
    })
  })

  it.each([{}, { data: null }, { data: [{ id: 123 }] }, { data: [{ id: '' }] }])('rejects malformed catalogs: %j', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
    await expect(fetchMagpieModelIds()).rejects.toThrow('Invalid Magpie model catalog')
  })

  it('preserves an empty catalog without inventing a model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })))
    expect(await fetchMagpieModelIds()).toEqual([])
  })

  it('returns a bounded 503 error on upstream failure rather than exposing upstream content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private upstream content', { status: 500 })))
    const { modelRouteModels } = await import('../../packages/server/src/modules/studio/controllers/chat-run')
    const ctx = { status: 200, body: undefined as unknown }
    await modelRouteModels(ctx as any)
    expect(ctx).toEqual({ status: 503, body: { error: 'Magpie model catalog unavailable' } })
  })

  it('returns models through the existing Studio API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'codex/exact' }] })))
    const { modelRouteModels } = await import('../../packages/server/src/modules/studio/controllers/chat-run')
    const ctx = { body: undefined as unknown }
    await modelRouteModels(ctx as any)
    expect(ctx.body).toEqual({ models: ['codex/exact'] })
  })
})
