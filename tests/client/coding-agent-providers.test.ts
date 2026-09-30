import { describe, expect, it } from 'vitest'
import {
  isKeylessModelProvider,
  canScopedCodingAgentUseProvider,
  isAuthModelProvider,
  usesServerManagedProviderAuth,
} from '../../packages/client/src/utils/codingAgentProviders'

describe('coding agent provider visibility', () => {
  it.each(['nous', 'openai-codex', 'copilot', 'xai-oauth', 'qwen-oauth', 'claude-oauth', 'minimax-oauth'])(
    'exposes %s to scoped Ekko sessions',
    (provider) => {
      expect(isAuthModelProvider(provider)).toBe(true)
      expect(canScopedCodingAgentUseProvider('ekko-agent', provider)).toBe(true)
      expect(usesServerManagedProviderAuth('ekko-agent', provider)).toBe(true)
    },
  )

  it('exposes only server-managed Codex OAuth to scoped OpenCode sessions', () => {
    expect(canScopedCodingAgentUseProvider('opencode', 'openai-codex')).toBe(true)
    expect(usesServerManagedProviderAuth('opencode', 'openai-codex')).toBe(true)
    for (const provider of ['copilot', 'xai-oauth', 'qwen-oauth', 'nous', 'claude-oauth', 'minimax-oauth']) {
      expect(canScopedCodingAgentUseProvider('opencode', provider)).toBe(false)
      expect(usesServerManagedProviderAuth('opencode', provider)).toBe(false)
    }
  })

  it.each(['claude-code', 'codex'] as const)(
    'keeps auth providers hidden from scoped %s sessions',
    (agentId) => {
      expect(canScopedCodingAgentUseProvider(agentId, 'openai-codex')).toBe(false)
      expect(canScopedCodingAgentUseProvider(agentId, 'qwen-oauth')).toBe(false)
      expect(usesServerManagedProviderAuth(agentId, 'openai-codex')).toBe(false)
      expect(canScopedCodingAgentUseProvider(agentId, 'deepseek')).toBe(true)
    },
  )
})


it('requires no key only for the native OpenCode Free provider', () => {
  expect(isKeylessModelProvider('opencode-free')).toBe(true)
  for (const provider of ['opencode-zen', 'custom:opencode-free', 'openai-api', undefined]) {
    expect(isKeylessModelProvider(provider)).toBe(false)
  }
})
