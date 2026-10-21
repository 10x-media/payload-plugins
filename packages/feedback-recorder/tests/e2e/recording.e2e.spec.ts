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

// Chrome's fake devices stand in for the screen picker and the microphone. Launch options
// cannot be set per describe group, hence a file of its own.
test.use({
	launchOptions: {
		args: [
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			'--auto-select-desktop-capture-source=Entire screen',
		],
	},
})

test('a plain link or location.assign into the admin keeps the recording going', async ({
	page,
}) => {
	await loginAdmin(page)
	await page.locator('.fr-header-button').click()
	await page.locator('.fr-drawer').getByRole('button', { name: 'Start recording' }).click()
	const bar = page.locator('.fr-bar')
	await expect(bar.getByText('Recording')).toBeVisible({ timeout: 15_000 })

	// Survives only if the document does; a reload would drop it.
	await page.evaluate(() => {
		;(window as Window & { __sameDocument?: boolean }).__sameDocument = true
		const link = document.createElement('a')
		link.href = '/admin/collections/users'
		link.textContent = 'plain link'
		link.id = 'plain-link'
		document.body.append(link)
	})
	await page.locator('#plain-link').click()
	await page.waitForURL(/\/admin\/collections\/users$/)
	await expect(bar.getByText('Recording')).toBeVisible()

	await page.evaluate(() => window.location.assign('/admin/account'))
	await page.waitForURL(/\/admin\/account$/)
	await expect(bar.getByText('Recording')).toBeVisible()
	expect(
		await page.evaluate(() => (window as Window & { __sameDocument?: boolean }).__sameDocument)
	).toBe(true)
})
