import { expect, test } from '@playwright/test'

const EMAIL = 'dev@10xmedia.de'
const PASSWORD = 'password'

const login = async (page: import('@playwright/test').Page) => {
	await page.goto('/admin/login')
	await page.fill('#field-email', EMAIL)
	await page.fill('#field-password', PASSWORD)
	await page.click('button[type="submit"]')
	await page.waitForURL('**/admin')
}

test('admin panel loads with webhooks plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('creating a post produces a successful delivery', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/posts/create')
	await page.fill('#field-title', 'E2E Post')
	const saveResponse = page.waitForResponse(
		(r) => r.url().includes('/api/posts') && r.request().method() === 'POST'
	)
	await page.click('#action-save')
	await saveResponse
	await page.waitForURL('**/admin/collections/posts/**')

	await page.goto('/admin/collections/webhook-deliveries')
	await page.waitForLoadState('networkidle')
	await expect(page.getByText('posts.created').first()).toBeVisible({ timeout: 15_000 })
	await expect(page.getByText('Delivered').first()).toBeVisible()
})

test('redeliver creates a second delivery', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/webhook-deliveries')
	await page.waitForLoadState('networkidle')
	const rowsBefore = await page.locator('tbody tr').count()
	await page.locator('tbody tr').first().getByRole('link').first().click()
	await page.waitForURL('**/admin/collections/webhook-deliveries/**')
	await page.getByRole('button', { name: 'Redeliver' }).click()
	await expect(page.getByText('Redelivery queued')).toBeVisible()
	await page.goto('/admin/collections/webhook-deliveries')
	await page.waitForLoadState('networkidle')
	await expect(page.locator('tbody tr')).toHaveCount(rowsBefore + 1)
})
