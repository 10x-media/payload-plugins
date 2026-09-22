import { expect, test } from '@playwright/test'

/**
 * The provider renders in the root layout, which a client navigation does not re-render, and the
 * login form reaches the admin with `router.push`. Whatever the provider rendered for the login
 * screen, where there is no reader yet, is what the admin's first render gets.
 */
test('signing in through the form lands on a working admin', async ({ page }) => {
	// The multi-tenant plugin refreshes the router once it has fetched the reader's tenants, which
	// re-renders the layout and hides the bug whenever it wins the race. Without it, nothing else
	// in the admin would refresh.
	await page.route('**/populate-tenant-options', (route) => route.abort())

	const errors: string[] = []
	page.on('pageerror', (error) => {
		errors.push(error.message)
	})
	page.on('console', (message) => {
		if (message.type() === 'error' && message.text().includes('settings overlay')) {
			errors.push(message.text())
		}
	})

	await page.goto('/admin/login')
	// A value typed before hydration is wiped by it.
	await page.waitForLoadState('networkidle')
	await page.locator('#field-email').fill('dev@10xmedia.de')
	await page.locator('#field-password').fill('password')
	await page.locator('button[type="submit"]').click()

	await expect(page).not.toHaveURL(/\/login/)
	await page.getByRole('button', { name: 'Open system settings' }).click()
	await expect(page.locator('.settings-overlay__panel')).toBeVisible()
	expect(errors).toEqual([])
})
