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

test('an authenticated admin can reach the Forms collection with seeded forms', async ({
	page,
}) => {
	const login = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(login.ok()).toBeTruthy()
	const response = await page.goto('/admin/collections/forms')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.getByText('Demo Contact')).toBeVisible()
})
