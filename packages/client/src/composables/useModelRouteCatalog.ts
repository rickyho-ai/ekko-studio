import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { fetchModelRouteModels, type ModelRouteRequest } from '@/api/studio/model-route'

export function useModelRouteCatalog(
  enabled: Readonly<Ref<boolean>>,
  route: Ref<ModelRouteRequest['routeId'] | undefined>,
  selectedModel: Ref<string | null>,
) {
  const models = ref<string[]>([])
  const loading = ref(false)
  const failed = ref(false)
  let pending: AbortController | undefined
  let generation = 0
  const options = computed(() => models.value
    .filter(id => route.value && id.startsWith(`${route.value}/`))
    .map(id => ({ label: id, value: id })))
  const selectionValid = computed(() => !loading.value && !failed.value && options.value.some(option => option.value === selectedModel.value))

  async function load() {
    pending?.abort()
    const current = ++generation
    if (!enabled.value) return
    const controller = new AbortController()
    pending = controller
    const timeout = setTimeout(() => controller.abort(), 7_000)
    loading.value = true
    failed.value = false
    models.value = []
    try {
      const catalog = await fetchModelRouteModels(controller.signal)
      if (current !== generation) return
      models.value = catalog
      if (!options.value.some(option => option.value === selectedModel.value)) selectedModel.value = ''
    } catch {
      if (current === generation) failed.value = true
    } finally {
      clearTimeout(timeout)
      if (current === generation) loading.value = false
    }
  }

  watch(route, () => {
    if (selectedModel.value && (!route.value || !selectedModel.value.startsWith(`${route.value}/`))) selectedModel.value = ''
  }, { flush: 'sync' })
  watch(enabled, () => {
    if (enabled.value) void load()
    else {
      generation++
      pending?.abort()
      loading.value = false
      models.value = []
      failed.value = false
    }
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { generation++; pending?.abort() })
  return { options, loading, failed, selectionValid, load }
}
