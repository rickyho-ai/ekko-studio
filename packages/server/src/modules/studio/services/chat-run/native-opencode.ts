import { OpenCode, type OpenCodeClient } from '@opencode/client'
import { Service } from '@opencode/client/service'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createSession, getSession, updateSession } from '../../repositories/session-store'
import { snapshotModelRoute, type ModelRouteRequest } from '../../contracts/model-route'

/** Discover only: this adapter must never spawn, restart, configure, or stop OpenCode. */
export async function nativeOpenCodeClient(): Promise<OpenCodeClient> {
  const endpoint = await Service.discover({
    file: process.env.EKKO_OPENCODE_SERVICE_FILE || undefined,
    version: '2.0.20',
  })
  if (!endpoint) throw new Error('Native OpenCode 2.0.20 service unavailable; no runtime was started')
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
}

export function nativeOpenCodeModel(intent: unknown) {
  const route = snapshotModelRoute(intent)
  if (!route?.modelId || !route.modelId.startsWith(`${route.routeId}/`)) {
    throw new Error('Native OpenCode requires explicit modelRoute and a matching route/model ID')
  }
  return { route, model: { providerID: `magpie-${route.agentId}-${route.routeId}`, id: route.modelId } }
}

/** Bounded, secret-free transport failure with persisted native identity/intent. */
export function nativeOpenCodeFailure(error: unknown, sessionId: string, intent?: ModelRouteRequest) {
  const stored = getSession(sessionId)
  const route = snapshotModelRoute(intent ?? stored?.modelRoute)
  const name = error instanceof Error ? error.name : ''
  const unavailable = error instanceof Error && error.message === 'Native OpenCode 2.0.20 service unavailable; no runtime was started'
  const missing = name === 'SessionNotFoundError'
  const timedOut = name === 'TimeoutError' || name === 'AbortError'
  const connection = name === 'TypeError' || name === 'ConnectionError'
  const status = missing ? 404 : unavailable || connection ? 503 : timedOut ? 504 : 502
  const message = missing
    ? 'Native OpenCode session not found; persisted mapping retained, no replacement session created'
    : unavailable || connection
      ? 'Native OpenCode service unavailable or connection failed; no runtime was started and no fallback was used'
      : timedOut
        ? 'Native OpenCode request timed out; native state must be checked before retrying; no replacement or fallback was used'
        : 'Native OpenCode request failed; persisted mapping retained, no replacement or fallback was used'
  return { status, body: {
    error: message, code: missing ? 'native_session_missing' : unavailable || connection ? 'native_service_unavailable' : timedOut ? 'native_request_timeout' : 'native_request_failed',
    sessionId, opencodeSessionId: stored?.agent_native_session_id || undefined, workspace: stored?.workspace,
    modelRoute: route, model: route?.modelId ? { providerID: `magpie-${route.agentId}-${route.routeId}`, id: route.modelId } : undefined,
  } }
}

const requestOptions = () => ({ signal: AbortSignal.timeout(15_000) })
const admissions = new Set<string>()

async function assertNativeMagpieModel(api: OpenCodeClient, directory: string, route: ModelRouteRequest) {
  const { model } = nativeOpenCodeModel(route)
  // 2.0.20 returns snapshots before a cold location's config plugins settle.
  // A persisted provider is not absent merely because startup is still loading it.
  const startup = requestOptions()
  let plugins
  try {
    while (true) {
      plugins = await api.plugin.list({ location: { directory } }, startup)
      const registration = plugins.data.find(plugin => plugin.id === 'opencode.config.provider')
      if (registration?.state.status === 'failed') throw new Error('Native OpenCode provider configuration initialization failed; prompt not sent')
      if (registration?.state.status === 'active') break
      await delay(100, undefined, startup)
    }
  } catch (error) {
    if (startup.signal.aborted) throw new Error('Native OpenCode provider configuration readiness timed out after 15 seconds; prompt not sent')
    throw error
  }
  const [catalog, provider] = await Promise.all([
    api.model.list({ location: { directory } }, requestOptions()),
    api.provider.get({ providerID: model.providerID, location: { directory } }, requestOptions()),
  ])
  const selected = catalog.data.find(candidate => candidate.providerID === model.providerID && candidate.id === model.id && candidate.enabled)
  if (!selected || selected.modelID !== model.id) throw new Error('Explicit Magpie model is unavailable or aliased in native OpenCode; no fallback was used')
  if (!plugins.data.some(plugin => plugin.id === 'ekko.native-magpie' && plugin.state.status === 'active')) throw new Error('Native OpenCode Magpie session-header hook is not active')
  const expectedPackage = route.routeId === 'claude' ? '@opencode/ai/providers/anthropic' : '@opencode/ai/providers/openai/responses'
  if (provider.data.settings?.baseURL !== 'http://127.0.0.1:3425/v1' || provider.data.package !== expectedPackage) throw new Error('Native OpenCode Magpie provider endpoint/protocol mismatch')
}

export async function sendNativeOpenCodePrompt(input: {
  sessionId: string
  profile: string
  text: string
  workspace?: string | null
  modelRoute?: ModelRouteRequest
  userId?: string
  continueOnly?: boolean
}, client?: OpenCodeClient) {
  if (!input.sessionId || !input.text.trim()) throw new Error('sessionId and prompt are required')
  if (admissions.has(input.sessionId)) throw new Error('Native OpenCode admission already in progress')
  admissions.add(input.sessionId)
  try {
    const stored = getSession(input.sessionId)
    if (stored && (stored.profile !== input.profile || stored.agent !== 'opencode')) throw new Error('Native OpenCode session mapping belongs to another profile/runtime')
    const { route, model } = nativeOpenCodeModel(input.modelRoute ?? stored?.modelRoute)
    if (input.continueOnly && !stored?.agent_native_session_id) throw new Error('Native OpenCode continuation requires an existing persisted session ID')
    // Never reinterpret an old isolated runtime as a new native session.
    if (stored && !stored.agent_native_session_id && stored.agent_session_id) throw new Error('Legacy OpenCode session has no shared native mapping; create a new objective explicitly')
    const api = client ?? await nativeOpenCodeClient()
    let native
    if (stored?.agent_native_session_id) {
      native = await api.session.get({ sessionID: stored.agent_native_session_id }, requestOptions())
      if (native.id !== stored.agent_native_session_id) throw new Error('Native OpenCode returned a different session ID')
      if (input.workspace && await realpath(input.workspace) !== native.location.directory) throw new Error('Workspace differs from authoritative native OpenCode session location')
    } else {
      if (!input.workspace || !isAbsolute(input.workspace)) throw new Error('An existing absolute project/workspace directory is required')
      const directory = await realpath(input.workspace)
      if (!(await stat(directory)).isDirectory()) throw new Error('Workspace is not a directory')
      // Stable create identity makes an ambiguous network admission retry unable to create a replacement.
      const id = `ses_ekko${createHash('sha256').update(`${input.profile}\0${input.sessionId}`).digest('hex').slice(0, 32)}`
      await assertNativeMagpieModel(api, directory, route)
      native = await api.session.create({ id, title: input.text.slice(0, 100), location: { directory }, model }, requestOptions())
      if (native.id !== id || native.location.directory !== directory) throw new Error('Native OpenCode creation identity/location mismatch')
      if (!stored) createSession({ id: input.sessionId, profile: input.profile, agent: 'opencode', source: 'coding_agent', user_id: input.userId })
    }
    const directory = native.location.directory
    // Save only orchestration identity/configuration, never native messages or tool history.
    updateSession(input.sessionId, {
      agent: 'opencode', agent_mode: 'global', agent_session_id: native.id,
      agent_native_session_id: native.id, workspace: directory, modelRoute: route,
    })
    if (getSession(input.sessionId)?.agent_native_session_id !== native.id) throw new Error('Native OpenCode mapping was not durably persisted; prompt not sent')
    await assertNativeMagpieModel(api, directory, route)
    if (native.model?.providerID !== model.providerID || native.model.id !== model.id) {
      await api.session.switchModel({ sessionID: native.id, model }, requestOptions())
    }
    const selected = await api.session.get({ sessionID: native.id }, requestOptions())
    if (selected.model?.providerID !== model.providerID || selected.model.id !== model.id) throw new Error('Native OpenCode did not retain the explicit model; prompt not sent')
    const admission = await api.session.prompt({ sessionID: native.id, text: input.text, delivery: 'queue' }, requestOptions())
    return { sessionId: input.sessionId, opencodeSessionId: native.id, workspace: directory, modelRoute: route, admissionId: admission.id }
  } finally {
    admissions.delete(input.sessionId)
  }
}

export async function readNativeOpenCodeState(sessionId: string, client?: OpenCodeClient) {
  const stored = getSession(sessionId)
  if (stored?.agent !== 'opencode' || !stored.agent_native_session_id) throw new Error('No persisted native OpenCode session mapping')
  const api = client ?? await nativeOpenCodeClient()
  const sessionID = stored.agent_native_session_id
  const [session, active, messages, diffs] = await Promise.all([
    api.session.get({ sessionID }, requestOptions()),
    api.session.active(requestOptions()),
    api.message.list({ sessionID, limit: 1, order: 'desc', type: 'assistant' }, requestOptions()),
    api.session.diff({ sessionID, context: 3 }, requestOptions()),
  ])
  const latest = messages.data.find(message => message.type === 'assistant')
  const output = latest?.type === 'assistant'
    ? latest.content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 32_768)
    : ''
  return {
    sessionId, opencodeSessionId: session.id, workspace: session.location.directory,
    model: session.model, isWorking: Boolean(active[sessionID]), outcome: session.outcome,
    messageId: latest?.id,
    output: session.outcome === 'failed' ? '' : output,
    error: latest?.type === 'assistant' && latest.error
      ? `Magpie upstream/provider failure (${latest.error.type}); no provider/model fallback was used`
      : session.outcome === 'failed' ? 'Native OpenCode execution failed for the selected provider/model; no fallback was used' : undefined,
    diffs: diffs.slice(0, 20).map(diff => ({ file: diff.file, additions: diff.additions, deletions: diff.deletions })),
  }
}
