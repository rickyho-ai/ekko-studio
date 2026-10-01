import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const sdk = vi.hoisted(() => ({ discover: vi.fn(), make: vi.fn(), headers: vi.fn(() => ({ authorization: 'private-service-auth' })) }))
vi.mock('@opencode/client', () => ({ OpenCode: { make: sdk.make } }))
vi.mock('@opencode/client/service', () => ({ Service: { discover: sdk.discover, headers: sdk.headers } }))

describe('native OpenCode Fast V1', () => {
  let db: any
  let store: typeof import('../../packages/server/src/modules/studio/repositories/session-store')
  let adapter: typeof import('../../packages/server/src/modules/studio/services/chat-run/native-opencode')
  let api: any
  const nativeSessions = new Map<string, any>()
  const route = { agentId: 'opencode' as const, routeId: 'codex' as const, modelId: 'codex/exact' }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    nativeSessions.clear()
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/modules/studio/infrastructure/database/index', () => ({ getDb: () => db, getStoragePath: () => ':memory:', isSqliteAvailable: () => true }))
    const { initAllHermesTables } = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    initAllHermesTables()
    store = await import('../../packages/server/src/modules/studio/repositories/session-store')
    adapter = await import('../../packages/server/src/modules/studio/services/chat-run/native-opencode')
    api = {
      session: {
        create: vi.fn(async (input: any) => {
          if (nativeSessions.has(input.id)) throw new Error('Session already exists')
          const native = { id: input.id, location: input.location, model: input.model, outcome: 'succeeded' }
          nativeSessions.set(native.id, native)
          return native
        }),
        get: vi.fn(async ({ sessionID }: any) => {
          const native = nativeSessions.get(sessionID)
          if (!native) throw new Error('Session not found')
          return native
        }),
        switchModel: vi.fn(async ({ sessionID, model }: any) => { nativeSessions.get(sessionID).model = model }),
        prompt: vi.fn(async ({ sessionID }: any) => {
          expect(store.getSession('objective')?.agent_native_session_id).toBe(sessionID)
          return { id: 'admission-1' }
        }),
        active: vi.fn(async () => ({})),
        wait: vi.fn(async () => {}),
        diff: vi.fn(async () => [{ file: 'src/file.ts', additions: 1, deletions: 0, diff: 'not mirrored' }]),
      },
      model: { list: vi.fn(async () => ({ data: [{ providerID: 'magpie-opencode-codex', id: 'codex/exact', modelID: 'codex/exact', enabled: true }] })) },
      plugin: { list: vi.fn(async () => ({ data: [{ id: 'opencode.config.provider', state: { status: 'active' } }, { id: 'ekko.native-magpie', state: { status: 'active' } }] })) },
      provider: { get: vi.fn(async () => ({ data: { package: '@opencode/ai/providers/openai/responses', settings: { baseURL: 'http://127.0.0.1:3425/v1' } } })) },
      message: { list: vi.fn(async () => ({ data: [{ type: 'assistant', content: [{ type: 'text', text: 'done' }] }] })) },
    }
    sdk.discover.mockResolvedValue({ url: 'http://127.0.0.1:4096', auth: { type: 'basic', username: 'opencode', password: 'not-logged' } })
    sdk.make.mockReturnValue(api)
  })
  afterEach(() => { db?.close(); vi.doUnmock('../../packages/server/src/modules/studio/infrastructure/database/index'); vi.unstubAllEnvs(); vi.resetModules() })

  it('creates a durable mapping before initial prompt, continues the same native session after reload, and never mirrors history', async () => {
    const first = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'Start objective', modelRoute: route })
    expect(api.session.create).toHaveBeenCalledTimes(1)
    expect(api.session.create.mock.calls[0][0]).toMatchObject({ location: { directory: process.cwd() }, model: { providerID: 'magpie-opencode-codex', id: 'codex/exact' } })
    vi.resetModules()
    const reopened = await import('../../packages/server/src/modules/studio/services/chat-run/native-opencode')
    const second = await reopened.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'Continue', continueOnly: true })
    expect(second.opencodeSessionId).toBe(first.opencodeSessionId)
    expect(api.session.create).toHaveBeenCalledTimes(1)
    expect(api.session.prompt.mock.calls.map((call: any[]) => call[0].sessionID)).toEqual([first.opencodeSessionId, first.opencodeSessionId])
    expect(store.getSession('objective')).toMatchObject({ agent_native_session_id: first.opencodeSessionId, workspace: process.cwd(), modelRoute: route, message_count: 0 })
    expect(await reopened.readNativeOpenCodeState('objective')).toMatchObject({ opencodeSessionId: first.opencodeSessionId, workspace: process.cwd(), output: 'done', isWorking: false, diffs: [{ file: 'src/file.ts', additions: 1, deletions: 0 }] })
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n).toBe(0)
    expect(api.message.list).toHaveBeenCalledWith({ sessionID: first.opencodeSessionId, limit: 1, order: 'desc', type: 'assistant' }, expect.any(Object))
  })

  it('does not replace a missing native session and does not create for continue without mapping', async () => {
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'missing', profile: 'default', text: 'continue', modelRoute: route, continueOnly: true })).rejects.toThrow('existing persisted')
    store.createSession({ id: 'objective', agent: 'opencode', agent_native_session_id: 'ses_missing', modelRoute: route })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'continue' })).rejects.toThrow('Session not found')
    expect(api.session.create).not.toHaveBeenCalled()
    expect(api.session.prompt).not.toHaveBeenCalled()
  })

  it.each([undefined, { agentId: 'opencode', routeId: 'codex' }, { agentId: 'opencode', routeId: 'codex', modelId: 'claude/wrong' }])('fails closed on missing/mismatched intent: %j', async modelRoute => {
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: modelRoute as any })).rejects.toThrow('explicit modelRoute')
    expect(sdk.discover).not.toHaveBeenCalled()
  })

  it('rejects unavailable or aliased models, wrong protocol, and missing native hook without creating a session', async () => {
    api.model.list.mockResolvedValueOnce({ data: [] })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })).rejects.toThrow('unavailable')
    api.model.list.mockResolvedValueOnce({ data: [{ providerID: 'magpie-opencode-codex', id: 'codex/exact', modelID: 'codex/alias', enabled: true }] })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })).rejects.toThrow('aliased')
    api.plugin.list.mockResolvedValueOnce({ data: [{ id: 'opencode.config.provider', state: { status: 'active' } }] })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })).rejects.toThrow('hook is not active')
    api.provider.get.mockResolvedValueOnce({ data: { settings: { baseURL: 'https://other' } } })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })).rejects.toThrow('endpoint/protocol')
    api.provider.get.mockResolvedValueOnce({ data: { package: '@opencode/ai/providers/openai-compatible/responses', settings: { baseURL: 'http://127.0.0.1:3425/v1' } } })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })).rejects.toThrow('endpoint/protocol')
    expect(api.session.create).not.toHaveBeenCalled()
    expect(api.session.prompt).not.toHaveBeenCalled()
  })

  it('rejects disposable/missing workspace and conflicting native directory without session replacement', async () => {
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'hello', modelRoute: route })).rejects.toThrow('absolute project')
    const first = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: '/tmp', text: 'continue' })).rejects.toThrow('authoritative')
    expect(store.getSession('objective')?.agent_native_session_id).toBe(first.opencodeSessionId)
    expect(api.session.create).toHaveBeenCalledTimes(1)
  })

  it('admits exact Claude intent only with the bundled native Messages package', async () => {
    const claudeRoute = { agentId: 'opencode' as const, routeId: 'claude' as const, modelId: 'claude/exact' }
    const model = { providerID: 'magpie-opencode-claude', id: 'claude/exact' }
    api.model.list.mockResolvedValue({ data: [{ ...model, modelID: model.id, enabled: true }] })
    api.provider.get.mockResolvedValueOnce({ data: { package: '@opencode/ai/providers/anthropic-compatible', settings: { baseURL: 'http://127.0.0.1:3425/v1' } } })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: claudeRoute })).rejects.toThrow('endpoint/protocol mismatch')
    expect(api.session.create).not.toHaveBeenCalled()
    expect(api.session.prompt).not.toHaveBeenCalled()
    api.provider.get.mockResolvedValue({ data: { package: '@opencode/ai/providers/anthropic', settings: { baseURL: 'http://127.0.0.1:3425/v1' } } })
    const admitted = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: claudeRoute })
    expect(api.session.create).toHaveBeenCalledWith(expect.objectContaining({ model }), expect.any(Object))
    expect(api.provider.get).toHaveBeenLastCalledWith({ providerID: model.providerID, location: { directory: process.cwd() } }, expect.any(Object))
    expect(api.session.switchModel).not.toHaveBeenCalled()
    expect(admitted.modelRoute).toEqual(claudeRoute)
    expect(store.getSession('objective')?.modelRoute).toEqual(claudeRoute)
  })

  it('waits for cold provider registration after service restart before continuing the same session', async () => {
    const first = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'start', modelRoute: route })
    vi.resetModules()
    const reopened = await import('../../packages/server/src/modules/studio/services/chat-run/native-opencode')
    let ready = false
    const settledPlugins = await api.plugin.list()
    api.plugin.list.mockImplementationOnce(async () => ({ data: [] }))
      .mockImplementationOnce(async () => { ready = true; return settledPlugins })
    const settledModels = await api.model.list()
    api.model.list.mockImplementation(async () => {
      expect(ready).toBe(true)
      return settledModels
    })
    api.provider.get.mockImplementation(async () => {
      if (!ready) throw new Error('Provider not found: magpie-opencode-codex')
      return { data: { package: '@opencode/ai/providers/openai/responses', settings: { baseURL: 'http://127.0.0.1:3425/v1' } } }
    })
    const second = await reopened.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'continue', continueOnly: true })
    expect(second.opencodeSessionId).toBe(first.opencodeSessionId)
    expect(api.session.create).toHaveBeenCalledTimes(1)
    expect(api.session.switchModel).not.toHaveBeenCalled()
    expect(api.session.prompt).toHaveBeenLastCalledWith({ sessionID: first.opencodeSessionId, text: 'continue', delivery: 'queue' }, expect.any(Object))
    expect(store.getSession('objective')).toMatchObject({ agent_native_session_id: first.opencodeSessionId, workspace: process.cwd(), modelRoute: route })
  })

  it('fails closed when provider configuration initialization fails', async () => {
    api.plugin.list.mockResolvedValueOnce({ data: [{ id: 'opencode.config.provider', state: { status: 'failed', error: 'startup failure' } }] })
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })).rejects.toThrow('configuration initialization failed')
    expect(api.provider.get).not.toHaveBeenCalled()
    expect(api.session.create).not.toHaveBeenCalled()
    expect(api.session.prompt).not.toHaveBeenCalled()
  })

  it('bounds provider startup readiness without replacing a persisted session', async () => {
    store.createSession({ id: 'objective', agent: 'opencode', agent_native_session_id: 'ses_existing', modelRoute: route })
    nativeSessions.set('ses_existing', { id: 'ses_existing', location: { directory: process.cwd() }, model: { providerID: 'magpie-opencode-codex', id: 'codex/exact' } })
    api.plugin.list.mockResolvedValue({ data: [] })
    // Shorten only the real deadline in this regression; preserve abort behavior.
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => nativeTimeout(Math.min(ms, 50)))
    try {
      await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'continue', continueOnly: true })).rejects.toThrow('readiness timed out after 15 seconds')
      expect(api.provider.get).not.toHaveBeenCalled()
      expect(api.session.create).not.toHaveBeenCalled()
      expect(api.session.prompt).not.toHaveBeenCalled()
      expect(store.getSession('objective')?.agent_native_session_id).toBe('ses_existing')
    } finally { deadline.mockRestore() }
  })

  it('retains a mapping on prompt admission failure so retry uses the same session', async () => {
    api.session.prompt.mockRejectedValueOnce(new Error('Network failure'))
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'hello', modelRoute: route })).rejects.toThrow('Network failure')
    const id = store.getSession('objective')?.agent_native_session_id
    const retry = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'continue', continueOnly: true })
    expect(retry.opencodeSessionId).toBe(id)
    expect(api.session.create).toHaveBeenCalledTimes(1)
  })

  it('preserves identity on native service outage and recovers without creating or switching a session', async () => {
    const first = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'start', modelRoute: route })
    sdk.discover.mockResolvedValueOnce(undefined)
    await expect(adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'continue', continueOnly: true })).rejects.toThrow('service unavailable')
    expect(api.session.create).toHaveBeenCalledTimes(1)
    expect(api.session.prompt).toHaveBeenCalledTimes(1)
    expect(store.getSession('objective')?.agent_native_session_id).toBe(first.opencodeSessionId)
    const recovered = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', text: 'continue', continueOnly: true })
    expect(recovered.opencodeSessionId).toBe(first.opencodeSessionId)
    expect(api.session.create).toHaveBeenCalledTimes(1)
    expect(api.session.switchModel).not.toHaveBeenCalled()
  })

  it('projects a provider outage with exact intent and never exposes provider bodies or stale success text', async () => {
    const first = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'start', modelRoute: route })
    nativeSessions.get(first.opencodeSessionId).outcome = 'failed'
    api.message.list.mockResolvedValueOnce({ data: [{ type: 'assistant', content: [{ type: 'text', text: 'stale success' }], error: { type: 'api', message: 'private upstream details', body: 'private secret' } }] })
    const failed = await adapter.readNativeOpenCodeState('objective')
    expect(failed).toMatchObject({ opencodeSessionId: first.opencodeSessionId, model: { providerID: 'magpie-opencode-codex', id: 'codex/exact' }, outcome: 'failed', output: '', error: 'Magpie upstream/provider failure (api); no provider/model fallback was used' })
    expect(JSON.stringify(failed)).not.toMatch(/private|stale success/)
    expect(api.session.create).toHaveBeenCalledTimes(1)
    expect(api.session.switchModel).not.toHaveBeenCalled()
  })

  it('does not emit stale success when native execution fails before creating an assistant', async () => {
    const first = await adapter.sendNativeOpenCodePrompt({ sessionId: 'objective', profile: 'default', workspace: process.cwd(), text: 'start', modelRoute: route })
    nativeSessions.get(first.opencodeSessionId).outcome = 'failed'
    expect(await adapter.readNativeOpenCodeState('objective')).toMatchObject({ output: '', outcome: 'failed', error: 'Native OpenCode execution failed for the selected provider/model; no fallback was used' })
  })

  it('redacts unknown transport errors while preserving native identity and exact requested route', () => {
    store.createSession({ id: 'objective', agent: 'opencode', agent_native_session_id: 'ses_existing', workspace: process.cwd(), modelRoute: route })
    const failure = adapter.nativeOpenCodeFailure(new Error('Authorization: Bearer private upstream secret'), 'objective')
    expect(failure).toMatchObject({ status: 502, body: { code: 'native_request_failed', opencodeSessionId: 'ses_existing', workspace: process.cwd(), modelRoute: route, model: { providerID: 'magpie-opencode-codex', id: 'codex/exact' } } })
    expect(JSON.stringify(failure)).not.toMatch(/Authorization|private upstream secret/)
  })

  it('emits service-unavailable provenance without admitting work or selecting a fallback', async () => {
    sdk.discover.mockResolvedValueOnce(undefined)
    const { handleNativeOpenCodeRun } = await import('../../packages/server/src/modules/studio/services/chat-run/handle-native-opencode-run')
    const emit = vi.fn()
    await handleNativeOpenCodeRun({ to: () => ({ emit }) } as any, { join: vi.fn(), data: {} } as any,
      { session_id: 'objective', input: 'hello', workspace: process.cwd(), modelRoute: route }, 'default', new Map())
    expect(emit).toHaveBeenCalledWith('run.failed', expect.objectContaining({ code: 'native_service_unavailable', error: expect.stringContaining('service unavailable'), modelRoute: route, model: { providerID: 'magpie-opencode-codex', id: 'codex/exact' } }))
    expect(api.session.create).not.toHaveBeenCalled()
    expect(api.session.prompt).not.toHaveBeenCalled()
    expect(api.session.switchModel).not.toHaveBeenCalled()
  })

  it('uses authenticated discover-only lifecycle and the optional registration file', async () => {
    vi.stubEnv('EKKO_OPENCODE_SERVICE_FILE', '/test/service.json')
    await adapter.nativeOpenCodeClient()
    expect(sdk.discover).toHaveBeenCalledWith({ file: '/test/service.json', version: '2.0.20' })
    expect(sdk.make).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:4096', headers: { authorization: 'private-service-auth' } })
    sdk.discover.mockResolvedValueOnce(undefined)
    await expect(adapter.nativeOpenCodeClient()).rejects.toThrow('no runtime was started')
    const source = readFileSync('packages/server/src/modules/studio/services/chat-run/native-opencode.ts', 'utf8')
    expect(source).not.toMatch(/OPENCODE_DB|OPENCODE_CONFIG_(DIR|CONTENT)|Service\.(ensure|start|stop)|spawn\(|exec\(|writeFile|apiKey|prepareCodingAgentLaunch|registerCodexProxyTarget|writeModelRunProfileToken/)
  })

  it('runs the native chat lifecycle without persisting messages or creating scoped runtime state', async () => {
    const { handleNativeOpenCodeRun } = await import('../../packages/server/src/modules/studio/services/chat-run/handle-native-opencode-run')
    const emit = vi.fn()
    const socket = { join: vi.fn(), data: { user: { id: 1 } } }
    const sessionMap = new Map()
    await handleNativeOpenCodeRun({ to: () => ({ emit }) } as any, socket as any,
      { session_id: 'objective', input: 'hello', workspace: process.cwd(), modelRoute: route }, 'default', sessionMap)
    const nativeId = store.getSession('objective')?.agent_native_session_id
    expect(api.session.wait).toHaveBeenCalledWith({ sessionID: nativeId }, expect.any(Object))
    expect(emit).toHaveBeenCalledWith('run.started', expect.objectContaining({ opencode_session_id: nativeId }))
    expect(emit).toHaveBeenCalledWith('run.completed', expect.objectContaining({ opencode_session_id: nativeId, output: 'done' }))
    expect(sessionMap.get('objective').isWorking).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n).toBe(0)
    expect(api.session.prompt).toHaveBeenCalledWith({ sessionID: nativeId, text: 'hello', delivery: 'queue' }, expect.any(Object))
  })
})
