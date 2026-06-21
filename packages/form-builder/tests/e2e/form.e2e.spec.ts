import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.describe('rendered multi-step form', () => {
	test('completes the flow with a conditional field, validation, and required consent', async ({
		page,
	}) => {
		await page.goto('/form')
		await expect(page.getByRole('heading', { name: 'Demo form' })).toBeVisible()

		// Step 1: required validation blocks an empty advance.
		await page.getByRole('button', { name: 'Next' }).click()
		await expect(page.getByRole('alert').first()).toBeVisible()

		await page.getByLabel('Full name').fill('Ada Lovelace')
		await page.getByLabel('Email').fill('ada@example.com')
		await page.getByRole('button', { name: 'Next' }).click()

		// Step 2: choosing 'Other' reveals the conditional field.
		await expect(page.getByLabel('Role')).toBeVisible()
		await page.getByLabel('Role').selectOption('other')
		await expect(page.getByLabel('Please specify')).toBeVisible()
		await page.getByLabel('Please specify').fill('Researcher')

		// Required consent: submit is blocked until agreed.
		await page.getByRole('button', { name: 'Submit' }).click()
		await expect(page.getByRole('alert').first()).toBeVisible()

		await page.getByLabel(/I agree to the terms/).check()
		await page.getByRole('button', { name: 'Submit' }).click()

		await expect(page.getByText('Thank you.')).toBeVisible()
	})

	test('the form page has no serious or critical axe violations', async ({ page }) => {
		await page.goto('/form')
		await expect(page.getByLabel('Full name')).toBeVisible()
		const results = await new AxeBuilder({ page }).analyze()
		const blocking = results.violations.filter(
			(violation) => violation.impact === 'serious' || violation.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})
})
