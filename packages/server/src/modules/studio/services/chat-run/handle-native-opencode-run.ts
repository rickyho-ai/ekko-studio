import type { Server, Socket } from 'socket.io'
import { randomUUID } from 'node:crypto'
import { getOrCreateSession } from './compression'
import type { SessionState } from './types'
import type { ModelRouteRequest } from '../../contracts/model-route'
import { nativeOpenCodeClient, readNativeOpenCodeState, sendNativeOpenCodePrompt } from './native-opencode'
import { getSession } from '../../repositories/session-store'

export async function handleNativeOpenCodeRun(
  nsp: ReturnType<Server['of']>, socket: Socket,
  data: { session_id?: string; input: unknown; workspace?: string | null; modelRoute?: ModelRouteRequest; onEvent?: (event: string, payload: any) => void; observeOnly?: boolean },
  profile: string, sessionMap: Map<string, SessionState>,
) {
  const sid = String(data.session_id || '')
  const state = getOrCreateSession(sessionMap, sid)
  const runId = randomUUID()
  const emit = (event: string, fields: Record<string, unknown> = {}) => {
    const payload = { event, session_id: sid, run_id: runId, ...fields }
    nsp.to(`session:${sid}`).emit(event, payload)
    data.onEvent?.(event, payload)
  }
  socket.join(`session:${sid}`)
  state.isWorking = true
  state.runId = runId
  state.profile = profile
  state.source = 'coding_agent'
  try {
    if (typeof data.input !== 'string') throw new Error('Native OpenCode Fast V1 accepts text prompts only')
    const client = await nativeOpenCodeClient()
    const admitted = data.observeOnly
      ? { opencodeSessionId: getSession(sid)?.agent_native_session_id || '', workspace: getSession(sid)?.workspace }
      : await sendNativeOpenCodePrompt({ sessionId: sid, profile, text: data.input, workspace: data.workspace,
          modelRoute: data.modelRoute, userId: socket.data?.user?.id == null ? undefined : String(socket.data.user.id) }, client)
    if (!admitted.opencodeSessionId) throw new Error('No persisted native OpenCode session mapping')
    emit('run.started', { opencode_session_id: admitted.opencodeSessionId, workspace: admitted.workspace })
    // Native OpenCode owns execution, including after the browser/Ekko disconnects.
    await client.session.wait({ sessionID: admitted.opencodeSessionId }, { signal: AbortSignal.timeout(120_000) })
    const result = await readNativeOpenCodeState(sid, client)
    if (result.output) emit('message.delta', { delta: result.output })
    if (result.isWorking || result.outcome !== 'succeeded' || result.error) emit('run.failed', { ...result, error: result.error || 'Native OpenCode execution is not confirmed successful; read native state before continuing' })
    else emit('run.completed', { output: result.output, opencode_session_id: result.opencodeSessionId })
  } catch (err) {
    emit('run.failed', { error: err instanceof Error ? err.message : 'Native OpenCode request failed' })
  } finally {
    state.isWorking = false
    state.runId = undefined
  }
}
