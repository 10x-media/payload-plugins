import { expect, test } from '@playwright/test'

test('admin panel loads with automations plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('payload health endpoint responds', async ({ request }) => {
	const response = await request.get('/admin')
	expect(response.status()).toBeLessThan(500)
})

test('the seeded admin logs in, so Payload initialised and seeded', async ({ request }) => {
	const response = await request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(response.status()).toBe(200)
})
