import { fileURLToPath } from 'node:url'

/** Print a config fragment for approval. Never writes/reloads live configuration. */
export function nativeMagpieConfig(ids) {
  const providers = {}
  for (const caller of ['opencode', 'hermes']) {
    for (const route of ['codex', 'claude']) {
      const models = Object.fromEntries(ids.filter(id => id.startsWith(`${route}/`)).map(id => [id, {
        modelID: id, name: id, capabilities: { tools: true },
      }]))
      if (!Object.keys(models).length) continue
      providers[`magpie-${caller}-${route}`] = {
        name: `Magpie ${caller} ${route}`,
        package: route === 'claude' ? '@opencode/ai/providers/anthropic-compatible' : '@opencode/ai/providers/openai-compatible/responses',
        settings: { baseURL: 'http://127.0.0.1:3425/v1', apiKey: `magpie-${caller}`, transport: 'http' },
        headers: { authorization: `Bearer magpie-${caller}` },
        models,
      }
    }
  }
  if (!Object.keys(providers).length) throw new Error('Magpie returned no codex/ or claude/ models')
  return {
    $schema: 'https://opencode.ai/config.json', providers,
    plugins: [fileURLToPath(new URL('../integrations/opencode-magpie/', import.meta.url))],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const response = await fetch('http://127.0.0.1:3425/v1/models', { signal: AbortSignal.timeout(5_000), redirect: 'error' })
  if (!response.ok) throw new Error('Magpie catalog unavailable')
  const catalog = await response.json()
  if (!Array.isArray(catalog.data) || catalog.data.some(model => typeof model?.id !== 'string')) throw new Error('Invalid Magpie catalog')
  console.log(JSON.stringify(nativeMagpieConfig([...new Set(catalog.data.map(model => model.id))]), null, 2))
}
