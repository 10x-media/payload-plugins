import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('admin panel loads with analytics plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('payload health endpoint responds', async ({ request }) => {
	const response = await request.get('/admin')
	expect(response.status()).toBeLessThan(500)
})

test('dashboard shows an analytics metric widget with a non-zero value', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin')

	const widget = page.locator('.analytics-metric-widget').first()
	await expect(widget).toBeVisible()
	const value = (await widget.locator('.analytics-widget__value').innerText()).trim()
	expect(value.length).toBeGreaterThan(0)
	expect(value).not.toBe('-')
	expect(Number.parseInt(value.replace(/[^0-9]/g, ''), 10)).toBeGreaterThan(0)
})
