import { expect, type Page, test } from '@playwright/test'

import { ADMIN, currentStep, login, switchVariant } from './helpers'

/** Payload builds a field's id from its path with the dots replaced. */
const field = (page: Page, path: string) => page.locator(`#field-${path.replace(/\./g, '__')}`)

const pickOption = async (page: Page, path: string, option: string): Promise<void> => {
	await field(page, path).click()
	await page.getByRole('option', { exact: true, name: option }).click()
}

/** Fills the first step of the publishing wizard and moves to the second. */
const fillRole = async (page: Page, title: string): Promise<void> => {
	await field(page, 'title').fill(title)
	await pickOption(page, 'department', 'engineering')
	await pickOption(page, 'seniority', 'senior')
	await page.getByRole('button', { name: 'Next' }).click()
	await expect(currentStep(page)).toContainText('Where')
}

test.describe('openings showcase', () => {
	test.beforeEach(async ({ page }) => {
		await login(page, ADMIN)
	})

	test('opens the publishing wizard, with the component item reading the fields above it', async ({
		page,
	}) => {
		await page.goto('/admin/collections/openings/create')
		await expect(currentStep(page)).toContainText('The role')
		await expect(page.locator('.dev-hint')).toContainText('Pick a team and a level')

		// The step's presentational override, not the field's own label.
		await expect(page.locator('label[for="field-title"]')).toContainText('Job title')

		await pickOption(page, 'department', 'engineering')
		await pickOption(page, 'seniority', 'senior')
		await expect(page.locator('.dev-hint')).toContainText('from posting to signature')
	})

	test('drops the conditional step, blocks a backwards range and rounds the one it takes', async ({
		page,
	}) => {
		await page.goto('/admin/collections/openings/create')
		await fillRole(page, 'Platform Engineer')

		// The remote step's condition is server-side; answering "onsite" takes it out of the rail.
		await pickOption(page, 'workplace', 'onsite')
		await expect(page.locator('.form-variants__progress')).not.toContainText('Remote setup')
		await page.getByRole('button', { name: 'Next' }).click()
		await expect(currentStep(page)).toContainText('Compensation')

		await field(page, 'compensation.min').fill('90000')
		await field(page, 'compensation.max').fill('50000')
		await page.getByRole('button', { name: 'Next' }).click()
		await expect(page.locator('.form-variants__status-text--error')).toContainText(
			'below the bottom of it'
		)
		await expect(currentStep(page)).toContainText('Compensation')

		await field(page, 'compensation.max').fill('95500')
		await page.getByRole('button', { name: 'Next' }).click()
		await expect(currentStep(page)).toContainText('The pitch')

		// The gate patched the value on its way through, so the field holds the rounded one.
		await page.getByRole('button', { name: 'Back' }).click()
		await expect(currentStep(page)).toContainText('Compensation')
		await expect(field(page, 'compensation.max')).toHaveValue('96000')
	})

	test('counts the steps of the quick draft with the replaced Progress slot', async ({ page }) => {
		await page.goto('/admin/collections/openings/create?variant=quick')
		// The rail is gone; the counter stands in its place.
		await expect(page.locator('.form-variants__progress')).toHaveCount(0)
		await expect(page.locator('.dev-counter__count')).toHaveText('Step 1 of 3')

		await field(page, 'title').fill('Support Engineer')
		await pickOption(page, 'department', 'operations')
		await page.getByRole('button', { name: 'Next' }).click()
		await expect(page.locator('.dev-counter__count')).toHaveText('Step 2 of 3')
	})

	test('opens a seeded posting at its sections and saves from any of them', async ({ page }) => {
		await page.goto('/admin/collections/openings')
		await page.getByRole('link', { name: 'Senior Backend Engineer' }).click()
		// The document, not the list it was opened from: `page.url()` still holds the list until
		// the navigation settles. The parameter beats any stored choice, so the test is order-proof.
		await page.waitForURL(/\/openings\/[^/?]+$/)
		await page.goto(`${page.url()}?variant=sections`)

		await expect(currentStep(page)).toContainText('Role')
		await expect(field(page, 'title')).toHaveValue('Senior Backend Engineer')

		// `navigation: 'free'`: the last section opens from the first, and it hides its own header.
		await page.getByRole('button', { name: 'Internal' }).click()
		await expect(field(page, 'internalNotes')).toBeVisible()
		await expect(page.locator('.form-variants__step-header')).toHaveCount(0)

		// `save: 'always'` puts the controls in the top bar, and the collection keeps drafts.
		const header = page.locator('.form-variants__header')
		await expect(header.locator('#action-save-draft')).toBeVisible()
		await field(page, 'referralBonus').fill('2500')
		await expect(header.locator('#action-save')).toBeEnabled()
		await header.locator('#action-save').click()
		await expect(field(page, 'referralBonus')).toHaveValue('2500')

		// All four variants are on the switcher for an admin.
		await page.locator('.form-variants__switcher-trigger').click()
		await expect(page.locator('.form-variants__switcher-option')).toHaveCount(4)
	})

	test('ends the wizard on the consumer outcome after a publish', async ({ page }) => {
		await page.goto('/admin/collections/openings/create')
		await fillRole(page, 'Site Reliability Engineer')
		await pickOption(page, 'workplace', 'onsite')
		await page.getByRole('button', { name: 'Next' }).click()
		await page.getByRole('button', { name: 'Next' }).click()
		await expect(currentStep(page)).toContainText('The pitch')
		await page.getByRole('button', { name: 'Next' }).click()
		await expect(currentStep(page)).toContainText('Review')

		// The component step holds the save until its own question is answered.
		await expect(page.locator('.form-variants__status-text')).toContainText('Confirm the summary')
		await expect(page.locator('#action-save')).toBeDisabled()

		await page.locator('.dev-confirm input').check()
		await page.locator('#action-save').click()

		const outcome = page.locator('.dev-outcome')
		await expect(outcome).toContainText('The role is posted')
		await expect(outcome).toContainText('REQ-')
		await expect(outcome.getByRole('link', { name: 'Open the posting' })).toBeVisible()
	})

	test('switches between the variants without losing what was typed', async ({ page }) => {
		await page.goto('/admin/collections/openings/create')
		await field(page, 'title').fill('Data Engineer')

		await switchVariant(page, 'Quick draft')
		await expect(page.locator('.dev-counter__count')).toBeVisible()
		await expect(field(page, 'title')).toHaveValue('Data Engineer')

		await switchVariant(page, 'Full form')
		await expect(page.locator('.form-variants')).toHaveCount(0)
		await expect(field(page, 'title')).toHaveValue('Data Engineer')
	})
})
