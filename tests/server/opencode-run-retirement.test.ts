import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import { CodingAgentRunManager } from '../../packages/server/src/modules/coding-agents/services/runtime/run-manager'

vi.mock('child_process', async importOriginal => ({
  ...await importOriginal<typeof import('child_process')>(), spawn: vi.fn(),
}))

describe('disposable OpenCode runner retirement', () => {
  it.each(['global', 'scoped'] as const)('rejects direct %s manager start before creating runtime/session state or spawning', mode => {
    const manager = new CodingAgentRunManager()
    const ensureSession = vi.spyOn(manager as any, 'ensureDbSession')
    try {
      expect(() => manager.start({
        sessionId: 'objective', agentSessionId: 'legacy-run', agentId: 'opencode', mode,
        profile: 'default', provider: 'test', model: 'test', command: 'opencode', args: [],
        shellCommand: 'opencode', workspaceDir: process.cwd(),
      })).toThrow('Per-conversation OpenCode spawning is retired')
      expect(manager.hasSession('objective')).toBe(false)
      expect(manager.runIdForSession('objective')).toBeUndefined()
      expect(ensureSession).not.toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
    } finally { manager.shutdown() }
  })

  it('rejects a legacy in-memory send before writing a message, preparing a workspace or spawning', () => {
    const manager = new CodingAgentRunManager()
    const ensureSession = vi.spyOn(manager as any, 'ensureDbSession')
    const addMessage = vi.spyOn(manager as any, 'addUserMessage')
    const prepareWorkspace = vi.spyOn(manager as any, 'startWorkspaceRunDiff')
    const run = { id: 'legacy-run', launch: { agentId: 'opencode', sessionId: 'objective' }, exited: false }
    ;(manager as any).runs.set(run.id, run)
    ;(manager as any).sessionIndex.set('objective', run.id)
    try {
      expect(() => manager.send('objective', 'continue')).toThrow('Per-conversation OpenCode spawning is retired')
      expect(ensureSession).not.toHaveBeenCalled()
      expect(addMessage).not.toHaveBeenCalled()
      expect(prepareWorkspace).not.toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      ;(manager as any).runs.clear()
      ;(manager as any).sessionIndex.clear()
      manager.shutdown()
    }
  })

  it('contains no disposable OpenCode subprocess/parser or isolated DB model reader', () => {
    const source = readFileSync('packages/server/src/modules/coding-agents/services/runtime/run-manager.ts', 'utf8')
    expect(source).not.toMatch(/startOpenCodeTurn|handleOpenCodeLine|recordOpenCodeNativeSessionId|readOpenCodeMessageModel|OPENCODE_DB/)
  })
})
