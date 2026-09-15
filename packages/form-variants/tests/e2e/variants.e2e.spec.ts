import { expect, test } from '@playwright/test'

import {
	ADMIN,
	currentStep,
	EDITOR,
	fillIdentity,
	login,
	switchVariant,
	walkToDuplicateCheck,
} from './helpers'

test.describe('editor', () => {
	test.beforeEach(async ({ page }) => {
		await login(page, EDITOR)
	})

	test('gets the quick form with no switcher and walks its steps', async ({ page }) => {
		await page.goto('/admin/collections/people/create')
		const runner = page.locator('.form-variants')
		await expect(runner).toBeVisible()
		await expect(page.locator('.form-variants__switcher')).toHaveCount(0)
		await expect(currentStep(page)).toContainText('Who is this?')
		await expect(page.locator('#field-firstName')).toBeVisible()
		await expect(page.locator('#field-email')).toHaveCount(0)

		await page.getByRole('button', { name: 'Next' }).click()
		await expect(page.locator('.form-variants__status-text--error')).toBeVisible()

		await fillIdentity(page, { firstName: 'Linus', lastName: 'Torvalds' })
		await expect(page.locator('#field-email')).toBeVisible()
		await expect(page).not.toHaveURL(/step=/)
	})

	test('keeps the save controls off every step but the last one', async ({ page }) => {
		await page.goto('/admin/collections/people/create')
		await expect(page.getByRole('button', { name: 'Next' })).toBeVisible()
		await expect(page.locator('#action-save')).toHaveCount(0)

		await walkToDuplicateCheck(page, { firstName: 'Nikola', lastName: 'Tesla' })
		await expect(page.locator('#action-save')).toBeEnabled()
	})

	test('saves on the last step and shows the outcome the afterSave hook returned', async ({
		page,
	}) => {
		await page.goto('/admin/collections/people/create')
		await walkToDuplicateCheck(page, { firstName: 'Grete', lastName: 'Hermann' })
		await expect(page.locator('.form-variants__step')).toContainText('No one else is called')

		await page.locator('#action-save').click()

		const outcome = page.locator('.dev-outcome')
		await expect(outcome).toBeVisible()
		await expect(outcome).toContainText('An admin can complete the remaining fields')
		await expect(outcome.getByRole('link', { name: 'Add another person' })).toBeVisible()
		// The outcome replaces the wizard rather than sitting under it.
		await expect(page.locator('.form-variants__step')).toHaveCount(0)
	})

	test('ends without saving when the duplicate check finds a match', async ({ page }) => {
		await page.goto('/admin/collections/people/create')
		// Ada Lovelace is seeded, so the check finds her and blocks the save.
		await walkToDuplicateCheck(page, { firstName: 'Ada', lastName: 'Lovelace' })

		await expect(page.locator('.form-variants__status-text')).toContainText(
			'One person with this name already exists.'
		)
		await expect(page.locator('#action-save')).toHaveCount(0)

		await page.getByRole('button', { name: 'Request creation from an admin' }).click()

		const outcome = page.locator('.dev-outcome')
		await expect(outcome).toContainText('Request sent')
		await expect(outcome).toContainText('An admin has been asked to review')
	})

	test('gets the same quick form in a relationship drawer', async ({ page }) => {
		await page.goto('/admin/collections/companies')
		await page.getByRole('link', { name: 'Acme' }).click()
		await expect(page.locator('#field-contacts')).toBeVisible()

		await page.locator('.relationship-add-new__add-button').click()

		const drawer = page.locator('.doc-drawer')
		await expect(drawer).toBeVisible()
		await expect(drawer.locator('.form-variants')).toBeVisible()
		await expect(drawer.locator('.form-variants__progress-item--current')).toContainText(
			'Who is this?'
		)
		await expect(drawer.locator('#field-firstName')).toBeVisible()
		// A drawer has no URL of its own, so neither parameter may appear.
		await expect(page).not.toHaveURL(/variant=|step=/)
		// The editor has one form here as on the page.
		await expect(drawer.locator('.form-variants__switcher')).toHaveCount(0)
	})

	test('gets the empty state on a collection with no form for editors', async ({ page }) => {
		await page.goto('/admin/collections/secrets/create')
		await expect(page.locator('.form-variants__empty')).toBeVisible()
	})
})

test.describe('admin', () => {
	test.beforeEach(async ({ page }) => {
		await login(page, ADMIN)
	})

	test('switches from the native form to the quick form and back, keeping values', async ({
		page,
	}) => {
		await page.goto('/admin/collections/people/create')
		await expect(page.locator('.form-variants__switcher')).toBeVisible()
		await expect(page.locator('.form-variants')).toHaveCount(0)
		await expect(page.locator('#field-email')).toBeVisible()

		await page.locator('#field-firstName').fill('Emmy')
		await switchVariant(page, 'Quick form')
		await expect(page.locator('.form-variants')).toBeVisible()
		expect(page.url()).toContain('variant=quick')
		// The state of the form being left is handed to the one taking its place.
		await expect(page.locator('#field-firstName')).toHaveValue('Emmy')

		await page.locator('#field-lastName').fill('Noether')
		await switchVariant(page, 'Full form')
		await expect(page.locator('.form-variants')).toHaveCount(0)
		await expect(page.locator('#field-firstName')).toHaveValue('Emmy')
		await expect(page.locator('#field-lastName')).toHaveValue('Noether')
	})

	test('ignores a variant parameter the account cannot use', async ({ page }) => {
		await page.goto('/admin/collections/people/create?variant=ghost')
		await expect(page.locator('#field-email')).toBeVisible()
	})

	test('opens any section of the review variant and saves from it', async ({ page }) => {
		await page.goto('/admin/collections/people')
		await page.getByRole('link', { name: 'Lovelace' }).click()
		await expect(page.locator('#field-firstName')).toBeVisible()

		await switchVariant(page, 'Review')
		await expect(page.locator('.form-variants')).toBeVisible()
		await expect(currentStep(page)).toContainText('Identity')

		// `navigation: 'free'` opens a section that was never visited, skipping the one between.
		await page.getByRole('button', { name: 'Work' }).click()
		await expect(currentStep(page)).toContainText('Work')
		await expect(page.locator('#field-employer')).toBeVisible()

		// `save: 'always'` keeps the save control in the top bar on every section.
		await page.locator('#field-position').fill('Mathematician')
		const save = page.locator('.form-variants__header #action-save')
		await expect(save).toBeEnabled()
		await save.click()
		await expect(page.locator('#field-position')).toHaveValue('Mathematician')

		// Leave the stored choice as the other tests expect to find it.
		await switchVariant(page, 'Full form')
		await expect(page.locator('.form-variants')).toHaveCount(0)
	})
})
