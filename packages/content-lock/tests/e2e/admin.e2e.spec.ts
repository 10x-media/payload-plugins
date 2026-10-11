import { expect, test } from '@playwright/test'

import { firstID, login } from './helpers'

// The dev seed has an active lock on the catalog group (products, categories) ending
// in two hours, an announced lock over everything starting tomorrow (with its own
// message), and an announced lock on the site group (pages, posts) in three days.

test.beforeEach(async ({ page }) => {
	await login(page)
})

test('an active lock shows a banner that cannot be dismissed', async ({ page }) => {
	await page.goto('/admin/collections/products')
	const banner = page.locator('.content-lock-banner--active')
	await expect(banner).toBeVisible()
	await expect(banner).toContainText('Maintenance in progress')
	await expect(banner.locator('.content-lock-banner__dismiss')).toHaveCount(0)
})

test('an active lock pages to the announcements behind it', async ({ page }) => {
	await page.goto('/admin/collections/products')
	const banner = page.locator('.content-lock-banner')
	await expect(banner.locator('.content-lock-banner__position')).toHaveText('1/2')
	await banner.getByRole('button', { name: 'Next notice' }).click()
	await expect(banner).toHaveClass(/content-lock-banner--announced/)
	await expect(banner).toContainText('We are moving to a new database')
})

test('a document in scope renders read-only', async ({ page }) => {
	const id = await firstID(page, 'products')
	await page.goto(`/admin/collections/products/${id}`)
	await expect(page.locator('#field-title')).toBeDisabled()
})

test('writes to a locked collection answer 503 with Retry-After', async ({ page }) => {
	const res = await page.request.post('/api/products', { data: { title: 'blocked' } })
	expect(res.status()).toBe(503)
	expect(res.headers()['retry-after']).toBe('3600')
})

test('a dismissed announcement reveals the next one and stays dismissed', async ({ page }) => {
	await page.goto('/admin/collections/pages')
	const banner = page.locator('.content-lock-banner--announced')
	await expect(banner).toContainText('We are moving to a new database')
	await banner.locator('.content-lock-banner__dismiss').click()
	await expect(banner).toContainText('Relaunch on')
	await page.reload()
	// Announcements render only once the preference is read; let that settle first.
	await page.waitForLoadState('networkidle')
	await expect(page.locator('.content-lock-banner--announced')).toContainText('Relaunch on')
	await expect(page.locator('.content-lock-banner__position')).toHaveCount(0)
})
