import { expect, test } from '@playwright/test'

import { ADMIN, createDoc, login, openCollectionList, openDoc, VIEWER } from './helpers'

test('admin panel loads with sse plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('payload health endpoint responds', async ({ request }) => {
	const response = await request.get('/admin')
	expect(response.status()).toBeLessThan(500)
})

test('live list shows a post created via REST', async ({ page }) => {
	await login(page)
	await openCollectionList(page, 'posts')

	const title = `live-list-${Date.now()}`
	await createDoc(page, 'posts', { title })

	await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 })
})

test('presence chip shows the other viewer', async ({ browser, page }) => {
	await login(page, ADMIN)

	const title = `presence-${Date.now()}`
	const id = await createDoc(page, 'posts', { title })
	await openDoc(page, 'posts', id)

	const contextB = await browser.newContext()
	const pageB = await contextB.newPage()
	await login(pageB, VIEWER)
	await openDoc(pageB, 'posts', id)

	await expect(page.getByText('also viewing')).toBeVisible({ timeout: 20_000 })

	await contextB.close()
})

test('list still updates after stream abort then restore', async ({ page }) => {
	await login(page)
	await openCollectionList(page, 'posts')

	await page.route('**/api/realtime/stream**', (route) => route.abort())

	const blockedTitle = `blocked-${Date.now()}`
	await createDoc(page, 'posts', { title: blockedTitle })
	await page.waitForTimeout(1_500)
	await expect(page.getByText(blockedTitle)).toHaveCount(0)

	await page.unroute('**/api/realtime/stream**')
	await page.reload()
	await openCollectionList(page, 'posts')

	const restoredTitle = `restored-${Date.now()}`
	await createDoc(page, 'posts', { title: restoredTitle })
	await expect(page.getByText(restoredTitle)).toBeVisible({ timeout: 20_000 })
})
