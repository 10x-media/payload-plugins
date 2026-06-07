import { expect, test } from '@playwright/test'

test('admin panel loads with formBuilder plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('admin route responds', async ({ request }) => {
	const response = await request.get('/admin')
	expect(response.status()).toBeLessThan(500)
})
