import { Plugin } from '@opencode/plugin'

/** Native OpenCode hook only; no proxy, credentials, DB, or session orchestration. */
export function stampMagpieRequest(event) {
  const match = /^magpie-(opencode|hermes)-(codex|claude)$/.exec(event.model.providerID)
  if (!match) return
  const [, caller, route] = match
  const url = new URL(event.request.url)
  if (url.origin !== 'http://127.0.0.1:3425' || url.pathname !== (route === 'claude' ? '/v1/messages' : '/v1/responses')) {
    throw new Error('Magpie native provider endpoint mismatch; refusing fallback')
  }
  if (!event.model.id.startsWith(`${route}/`) || !event.sessionID) throw new Error('Magpie native provider requires explicit route/model/session identity')
  event.request.headers.set('authorization', `Bearer magpie-${caller}`)
  event.request.headers.set('X-Magpie-Session', event.sessionID)
}

export default Plugin.define({
  id: 'ekko.native-magpie',
  async setup(ctx) {
    await ctx.session.hook('http.request', stampMagpieRequest)
  },
})
