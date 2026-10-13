import { expect, type Page, test } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

const loginAdmin = async (page: Page) => {
	await page.goto('/admin/login')
	await page.locator('#field-email, input[name="email"]').first().fill(ADMIN.email)
	await page.locator('#field-password, input[name="password"]').first().fill(ADMIN.password)
	await page.getByRole('button', { name: /log in|login/i }).click()
	await page.waitForURL(/\/admin/)
	await expect(page).not.toHaveURL(/\/admin\/login/)
}

test('admin panel loads with feedbackRecorder plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('the header button opens the recorder drawer', async ({ page }) => {
	await loginAdmin(page)
	const button = page.locator('.fr-header-button')
	await expect(button).toBeVisible()
	await button.click()
	const drawer = page.locator('.fr-drawer')
	await expect(drawer.getByRole('tab', { name: 'New recording' })).toBeVisible()
	await expect(drawer.getByRole('button', { name: 'Start recording' })).toBeVisible()
	await drawer.getByRole('radio', { name: 'A question' }).check({ force: true })
	await expect(drawer.locator('.fr-kind--active')).toHaveText('A question')
})

test('my recordings reports a connection problem plainly', async ({ page }) => {
	await loginAdmin(page)
	await page.locator('.fr-header-button').click()
	const drawer = page.locator('.fr-drawer')
	await drawer.getByRole('tab', { name: 'My recordings' }).click()
	await expect(drawer.getByText('Your recordings could not be loaded.')).toBeVisible()
})
