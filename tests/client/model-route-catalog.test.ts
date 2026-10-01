import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useModelRouteCatalog } from '../../packages/client/src/composables/useModelRouteCatalog'

const fetchModels = vi.hoisted(() => vi.fn())
vi.mock('@/api/studio/model-route', () => ({ fetchModelRouteModels: fetchModels }))

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.forEach(scope => scope.stop()); scopes.length = 0; vi.resetAllMocks(); vi.useRealTimers() })

function setup(enabled = true) {
  const scope = effectScope()
  scopes.push(scope)
  const active = ref(enabled)
  const route = ref<'claude' | 'codex'>('claude')
  const model = ref<string | null>('')
  const catalog = scope.run(() => useModelRouteCatalog(active, route, model))!
  return { active, route, model, catalog }
}

describe('Magpie route catalog selection', () => {
  it('filters by exact route prefix, preserves IDs, and clears incompatible selections without a default', async () => {
    fetchModels.mockResolvedValue(['claude/sonnet', 'codex/gpt-exact', 'other/model', 'claude-not-a-route', 'codex/second'])
    const { route, model, catalog } = setup()
    expect(catalog.loading.value).toBe(true)
    expect(catalog.selectionValid.value).toBe(false)
    await nextTick()
    expect(catalog.options.value).toEqual([{ label: 'claude/sonnet', value: 'claude/sonnet' }])
    expect(model.value).toBe('')
    model.value = catalog.options.value[0].value
    expect(catalog.selectionValid.value).toBe(true)
    route.value = 'codex'
    expect(model.value).toBe('')
    expect(catalog.selectionValid.value).toBe(false)
    expect(catalog.options.value.map(option => option.value)).toEqual(['codex/gpt-exact', 'codex/second'])
    model.value = catalog.options.value[0].value
    expect(model.value).toBe('codex/gpt-exact')
    expect(catalog.selectionValid.value).toBe(true)
  })

  it.each([{ models: [] }, { models: ['other/model'] }, { models: ['codex/only'] }])('fails closed when the route has no valid models: %j', async ({ models }) => {
    fetchModels.mockResolvedValue(models)
    const { model, catalog } = setup()
    model.value = 'claude/stale'
    await nextTick()
    expect(catalog.options.value).toEqual([])
    expect(model.value).toBe('')
    expect(catalog.selectionValid.value).toBe(false)
  })

  it('fails closed on fetch failure and permits an explicit retry, never a fallback', async () => {
    fetchModels.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(['claude/exact'])
    const { model, catalog } = setup()
    model.value = 'claude/stale'
    await nextTick()
    expect(catalog.failed.value).toBe(true)
    expect(catalog.loading.value).toBe(false)
    expect(catalog.selectionValid.value).toBe(false)
    await catalog.load()
    expect(catalog.failed.value).toBe(false)
    expect(model.value).toBe('')
    expect(catalog.selectionValid.value).toBe(false)
  })

  it('does not fetch for non-Magpie flows and ignores stale responses after opt-out', async () => {
    let resolve!: (models: string[]) => void
    fetchModels.mockImplementation(() => new Promise<string[]>(done => { resolve = done }))
    const { active, catalog } = setup(false)
    expect(fetchModels).not.toHaveBeenCalled()
    active.value = true
    const signal = fetchModels.mock.calls[0][0] as AbortSignal
    active.value = false
    expect(signal.aborted).toBe(true)
    resolve(['claude/stale'])
    await nextTick()
    expect(catalog.options.value).toEqual([])
    expect(catalog.loading.value).toBe(false)
  })

  it('bounds a stalled request with an abort timeout', async () => {
    vi.useFakeTimers()
    fetchModels.mockImplementation((signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Timeout')))
    }))
    const { catalog } = setup()
    await vi.advanceTimersByTimeAsync(7_000)
    expect(catalog.failed.value).toBe(true)
    expect(catalog.loading.value).toBe(false)
    expect(catalog.selectionValid.value).toBe(false)
  })
})
