import { expect, test } from '@playwright/test'
import { authenticate, mockChatSocket, mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

test('selects Magpie intent independently of the Ekko runtime and submits an exact model', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  const api = await mockHermesApi(page)
  await mockChatSocket(page)
  await page.goto('/#/hermes/chat')
  await page.getByRole('button', { name: 'New Chat', exact: true }).click()
  const drawer = page.locator('.new-chat-drawer')
  await drawer.locator('.new-chat-field').filter({ hasText: /^Agent/ }).first().locator('.n-base-selection').click()
  await page.locator('.n-base-select-option:visible').filter({ hasText: /^Ekko$/ }).click()
  await drawer.locator('.new-chat-field').filter({ hasText: /^Magpie caller/ }).locator('.n-base-selection').click()
  await page.locator('.n-base-select-option:visible').filter({ hasText: /^Hermes$/ }).click()
  await expect(drawer.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  await drawer.locator('.new-chat-field').filter({ hasText: /^Model route/ }).locator('.n-base-selection').click()
  await page.locator('.n-base-select-option:visible').filter({ hasText: /^Codex$/ }).click()
  await expect(drawer.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  await drawer.locator('.new-chat-field').filter({ hasText: /^Explicit gateway model/ }).getByRole('textbox').fill('exact/gateway-model')
  await expect(drawer.locator('.new-chat-field').filter({ hasText: /^Provider/ })).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page).toHaveURL(/#\/hermes\/session\//)
  await page.getByPlaceholder('Type a message... (Enter to send, Shift+Enter for new line)').fill('Use my selected route')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__PW_CHAT_SOCKET__?.emitted?.find((item: any) => item.event === 'run')?.payload)).toMatchObject({
    coding_agent_id: 'ekko-agent',
    session_id: expect.any(String),
    modelRoute: { agentId: 'hermes', routeId: 'codex', modelId: 'exact/gateway-model' },
  })
  expect(api.unexpectedRequests).toEqual([])
})
