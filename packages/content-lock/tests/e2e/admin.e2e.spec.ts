import { expect, test } from '@playwright/test'

import { firstID, login } from './helpers'

// The dev seed has an active lock on the catalog group (products, categories) ending
// in two hours, and an announced lock over everything starting tomorrow.

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

test('an active lock ending soon counts down', async ({ page }) => {
	await page.goto('/admin/collections/products')
	await expect(page.locator('.content-lock-banner__countdown')).toContainText('Ends in')
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

test('an announcement off the locked scope can be dismissed for good', async ({ page }) => {
	await page.goto('/admin/collections/pages')
	const banner = page.locator('.content-lock-banner--announced')
	await expect(banner).toContainText('Planned maintenance')
	await banner.locator('.content-lock-banner__dismiss').click()
	await expect(banner).toHaveCount(0)
	await page.reload()
	// The announcement renders only once the preference is read; let that settle first.
	await page.waitForLoadState('networkidle')
	await expect(page.locator('.content-lock-banner--announced')).toHaveCount(0)
})
