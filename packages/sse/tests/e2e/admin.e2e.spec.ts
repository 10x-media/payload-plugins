import { expect, test } from '@playwright/test'

import { ADMIN, createDoc, login, openCollectionList, openDoc, updateDoc, VIEWER } from './helpers'

test('frontend playground loads', async ({ page }) => {
	const response = await page.goto('/')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

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

test('dirty editor sees a conflict banner when another user saves', async ({ browser, page }) => {
	await login(page, ADMIN)

	const title = `conflict-${Date.now()}`
	const id = await createDoc(page, 'posts', { title })
	await openDoc(page, 'posts', id)

	const titleInput = page.locator('#field-title')
	await expect(titleInput).toBeVisible({ timeout: 15_000 })
	await titleInput.fill(`${title}-dirty`)

	const contextB = await browser.newContext()
	const pageB = await contextB.newPage()
	await login(pageB, VIEWER)
	await updateDoc({ page: pageB, collection: 'posts', id, data: { title: `${title}-remote` } })

	const bannerCopy =
		'Someone else saved this document. Reload to see their version, or keep editing'
	await expect(page.getByText(bannerCopy)).toBeVisible({ timeout: 20_000 })
	await expect(page.locator('.doc-controls__controls .sse-document-conflict')).toHaveCount(0)
	await expect(page.locator('#action-save')).toBeInViewport()

	await page.getByRole('button', { name: 'Keep editing' }).click()
	await expect(page.getByText(bannerCopy)).toHaveCount(0)

	await updateDoc({ page: pageB, collection: 'posts', id, data: { title: `${title}-remote-2` } })
	await expect(page.getByText(bannerCopy)).toBeVisible({ timeout: 20_000 })

	await contextB.close()
})

test('list still updates after stream abort then restore', async ({ page }) => {
	await login(page)
	// Intercept before the list mounts. An already-open fetch stream is not aborted by route().
	await page.route('**/api/realtime/stream**', (route) => route.abort())
	await openCollectionList(page, 'posts')

	const blockedTitle = `blocked-${Date.now()}`
	await createDoc(page, 'posts', { title: blockedTitle })
	await expect(page.getByText(blockedTitle)).toHaveCount(0)

	const streamReconnect = page.waitForResponse(
		(res) => res.url().includes('/api/realtime/stream') && res.ok(),
		{ timeout: 15_000 }
	)
	await page.unroute('**/api/realtime/stream**')
	await streamReconnect

	const restoredTitle = `restored-${Date.now()}`
	await createDoc(page, 'posts', { title: restoredTitle })
	await expect(page.getByText(restoredTitle)).toBeVisible({ timeout: 20_000 })
})
