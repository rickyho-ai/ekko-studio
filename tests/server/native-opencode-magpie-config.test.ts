import { describe, expect, it } from 'vitest'
// @ts-expect-error Native plugin/config generator are executable JavaScript, not a server API.
import { nativeMagpieConfig } from '../../scripts/native-opencode-magpie-config.mjs'
// @ts-expect-error Native plugin/config generator are executable JavaScript, not a server API.
import { stampMagpieRequest } from '../../integrations/opencode-magpie/index.mjs'

describe('native OpenCode Magpie configuration', () => {
  it('uses exact Magpie inventory with native route packages and no default, proxy, or isolated DB', () => {
    const config = nativeMagpieConfig(['codex/exact', 'claude/exact', 'other/ignored'])
    expect(config.model).toBeUndefined()
    expect(Object.keys(config.providers)).toHaveLength(4)
    for (const provider of Object.values(config.providers) as Array<{ models: Record<string, { capabilities: unknown }> }>) {
      for (const model of Object.values(provider.models)) {
        expect(model.capabilities).toEqual({ tools: true, input: ['text'], output: ['text'] })
      }
    }
    expect(config.providers['magpie-opencode-codex']).toMatchObject({ package: '@opencode/ai/providers/openai/responses', settings: { baseURL: 'http://127.0.0.1:3425/v1' }, models: { 'codex/exact': { modelID: 'codex/exact' } } })
    expect(Object.keys(config.providers['magpie-hermes-claude'].models)).toEqual(['claude/exact'])
    expect(JSON.stringify(config)).not.toMatch(/OPENCODE_DB|proxy|token|default_model/)
    expect(() => nativeMagpieConfig([])).toThrow('no codex/')
  })

  it.each(['opencode', 'hermes'])('stamps %s identity and native session independently of route protocol', caller => {
    for (const route of ['codex', 'claude']) {
      const event = { sessionID: 'ses_native', model: { providerID: `magpie-${caller}-${route}`, id: `${route}/exact` }, request: new Request(`http://127.0.0.1:3425/v1/${route === 'claude' ? 'messages' : 'responses'}`) }
      stampMagpieRequest(event)
      expect(event.request.headers.get('authorization')).toBe(`Bearer magpie-${caller}`)
      expect(event.request.headers.get('X-Magpie-Session')).toBe('ses_native')
    }
  })

  it('fails closed on protocol/model mismatch and leaves other providers untouched', () => {
    const event = { sessionID: 'ses_native', model: { providerID: 'magpie-opencode-codex', id: 'codex/exact' }, request: new Request('http://127.0.0.1:3425/v1/messages') }
    expect(() => stampMagpieRequest(event)).toThrow('endpoint mismatch')
    event.request = new Request('http://127.0.0.1:3425/v1/responses')
    event.model.id = 'claude/wrong'
    expect(() => stampMagpieRequest(event)).toThrow('explicit route/model')
    event.model.providerID = 'other-provider'
    stampMagpieRequest(event)
    expect(event.request.headers.has('X-Magpie-Session')).toBe(false)
  })
})
