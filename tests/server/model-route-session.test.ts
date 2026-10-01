import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshotModelRoute } from '../../packages/server/src/modules/studio/contracts/model-route'

describe('session-owned model route intent', () => {
  let db: any
  beforeEach(async () => {
    vi.resetModules()
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/modules/studio/infrastructure/database/index', () => ({
      getDb: () => db, getStoragePath: () => ':memory:', isSqliteAvailable: () => true,
    }))
    const { initAllHermesTables } = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    initAllHermesTables()
  })
  afterEach(() => {
    db?.close()
    vi.doUnmock('../../packages/server/src/modules/studio/infrastructure/database/index')
    vi.resetModules()
  })

  it('preserves absent, omitted and explicit model intent across schema sync and reload', async () => {
    const store = await import('../../packages/server/src/modules/studio/repositories/session-store')
    store.createSession({ id: 'ordinary', provider: 'original', model: 'original-model' })
    store.createSession({ id: 'no-model', modelRoute: { agentId: 'opencode', routeId: 'claude' } })
    store.createSession({ id: 'explicit', modelRoute: { agentId: 'hermes', routeId: 'codex', modelId: 'exact/model' } })
    store.createSession({ id: 'empty', modelRoute: { agentId: 'hermes', routeId: 'claude', modelId: '' } })
    const { initAllHermesTables } = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    initAllHermesTables()
    vi.resetModules()
    const reloaded = await import('../../packages/server/src/modules/studio/repositories/session-store')
    expect(reloaded.getSession('ordinary')).toMatchObject({ provider: 'original', model: 'original-model', modelRoute: undefined })
    expect(reloaded.getSession('no-model')?.modelRoute).toEqual({ agentId: 'opencode', routeId: 'claude' })
    expect(reloaded.getSessionMetadata('explicit')?.modelRoute).toEqual({ agentId: 'hermes', routeId: 'codex', modelId: 'exact/model' })
    expect(reloaded.getSession('empty')?.modelRoute).toHaveProperty('modelId', '')
    reloaded.updateSession('explicit', { modelRoute: { agentId: 'opencode', routeId: 'claude' } })
    expect(reloaded.getSession('explicit')?.modelRoute).not.toHaveProperty('modelId')
  })

  it('snapshots intent independently and rejects invalid required fields', () => {
    const intent = { agentId: 'opencode' as const, routeId: 'codex' as const, modelId: 'first' }
    const captured = snapshotModelRoute(intent)
    intent.modelId = 'later'
    expect(captured?.modelId).toBe('first')
    expect(snapshotModelRoute(undefined)).toBeUndefined()
    expect(() => snapshotModelRoute({ routeId: 'codex' })).toThrow('agentId')
    expect(() => snapshotModelRoute({ agentId: 'opencode' })).toThrow('routeId')
    expect(() => snapshotModelRoute({ agentId: 'hermes', routeId: 'claude', modelId: null })).toThrow('modelId')
  })

  it('uses the existing session configuration endpoint without rewriting runtime/provider/model', async () => {
    const store = await import('../../packages/server/src/modules/studio/repositories/session-store')
    store.createSession({ id: 'settings-route', agent: 'ekko-agent', source: 'coding_agent', provider: 'original', model: 'ordinary' })
    const { setModel } = await import('../../packages/server/src/modules/studio/controllers/sessions')
    const modelRoute = { agentId: 'hermes', routeId: 'codex' }
    const ctx = { params: { id: 'settings-route' }, state: {}, request: { body: { modelRoute } }, body: undefined as any, status: 200 }
    await setModel(ctx)
    expect(ctx.body).toEqual({ ok: true })
    expect(store.getSession('settings-route')).toMatchObject({ agent: 'ekko-agent', provider: 'original', model: 'ordinary', modelRoute })
    expect(store.getSession('settings-route')?.modelRoute).not.toHaveProperty('modelId')
    ctx.request.body.modelRoute = { agentId: 'invalid', routeId: 'codex' }
    await setModel(ctx)
    expect(ctx.status).toBe(400)
    expect(store.getSession('settings-route')?.modelRoute).toEqual(modelRoute)
  })
})
