import { expect, type Page } from '@playwright/test'

export const ADMIN = 'dev@10xmedia.de'
export const EDITOR = 'editor@10xmedia.de'

/** Logs in over REST on the page's own request context, so the cookie lands in the browser. */
export const login = async (page: Page, email: string): Promise<void> => {
	const response = await page.request.post('/api/users/login', {
		data: { email, password: 'password' },
	})
	expect(response.ok()).toBe(true)
}

/** The step the wizard is standing on, by its tab in the progress rail. */
export const currentStep = (page: Page) => page.locator('.form-variants__progress-item--current')

/**
 * Fills the `identity` step of the people quick form and moves on. The date of birth is old
 * enough for the `contact` step's condition, so the walk always has three steps.
 */
export const fillIdentity = async (
	page: Page,
	names: { firstName: string; lastName: string }
): Promise<void> => {
	await page.locator('#field-firstName').fill(names.firstName)
	await page.locator('#field-lastName').fill(names.lastName)
	await page.locator('#field-dateOfBirth input').first().fill('12/28/1969')
	await page.keyboard.press('Escape')
	await page.locator('#field-gender').click()
	// `exact`, or the option list's "female" matches too and Playwright refuses the click.
	await page.getByRole('option', { exact: true, name: 'male' }).click()
	await page.getByRole('button', { name: 'Next' }).click()
	await expect(currentStep(page)).toContainText('How to reach them')
}

/** Walks from the empty create form to the duplicate check, the quick form's last step. */
export const walkToDuplicateCheck = async (
	page: Page,
	names: { firstName: string; lastName: string }
): Promise<void> => {
	await fillIdentity(page, names)
	await page.getByRole('button', { name: 'Next' }).click()
	await expect(currentStep(page)).toContainText('Check for duplicates')
}

/** Switches variants through the switcher, which is also what stores the choice. */
export const switchVariant = async (page: Page, label: string): Promise<void> => {
	await page.locator('.form-variants__switcher-trigger').click()
	// Popup list items are not buttons, and closed popups stay mounted: match the visible one.
	await page
		.locator('.form-variants__switcher-option:visible')
		.getByText(label, { exact: true })
		.click()
}
