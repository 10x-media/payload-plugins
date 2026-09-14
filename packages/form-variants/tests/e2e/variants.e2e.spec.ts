import { expect, type Page, test } from '@playwright/test'

const login = async (page: Page, email: string): Promise<void> => {
	await page.goto('/admin/login')
	await page.getByLabel(/email/i).fill(email)
	await page.getByLabel(/password/i).fill('password')
	await page.getByRole('button', { name: /login/i }).click()
	await page.waitForURL(/\/admin(?!\/login)/)
}

test.describe('editor', () => {
	test.beforeEach(async ({ page }) => {
		await login(page, 'editor@10xmedia.de')
	})

	test('gets the quick form with no switcher and walks its steps', async ({ page }) => {
		await page.goto('/admin/collections/people/create')
		const runner = page.locator('.form-variants')
		await expect(runner).toBeVisible()
		await expect(page.locator('.form-variants__switcher')).toHaveCount(0)
		const current = page.locator('.form-variants__progress-item--current')
		await expect(current).toContainText('Who is this?')
		await expect(page.locator('#field-firstName')).toBeVisible()
		await expect(page.locator('#field-email')).toHaveCount(0)

		await page.getByRole('button', { name: 'Next' }).click()
		await expect(page.locator('.form-variants__status-text--error')).toBeVisible()

		await page.locator('#field-firstName').fill('Linus')
		await page.locator('#field-lastName').fill('Torvalds')
		await page.locator('#field-dateOfBirth input').first().fill('12/28/1969')
		await page.keyboard.press('Escape')
		await page.locator('#field-gender').click()
		await page.getByRole('option', { name: 'male' }).click()
		await page.getByRole('button', { name: 'Next' }).click()

		await expect(current).toContainText('How to reach them')
		await expect(page.locator('#field-email')).toBeVisible()
		await expect(page.url()).toContain('step=contact')
	})

	test('gets the empty state on a collection with no form for editors', async ({ page }) => {
		await page.goto('/admin/collections/secrets/create')
		await expect(page.locator('.form-variants__empty')).toBeVisible()
	})
})

test.describe('admin', () => {
	test.beforeEach(async ({ page }) => {
		await login(page, 'dev@10xmedia.de')
	})

	test('opens the native form with a switcher and can switch to the quick form', async ({
		page,
	}) => {
		await page.goto('/admin/collections/people/create')
		await expect(page.locator('.form-variants__switcher')).toBeVisible()
		await expect(page.locator('.form-variants')).toHaveCount(0)
		await expect(page.locator('#field-email')).toBeVisible()

		await page.locator('.form-variants__switcher-trigger').click()
		await page.getByRole('button', { name: 'Quick form' }).click()
		await expect(page.locator('.form-variants')).toBeVisible()
		await expect(page.url()).toContain('variant=quick')
	})

	test('ignores a variant parameter the account cannot use', async ({ page }) => {
		await page.goto('/admin/collections/people/create?variant=ghost')
		await expect(page.locator('#field-email')).toBeVisible()
	})
})
