import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'

const FIXTURES = {
	collection: 'encrypted',
	docTitle: 'Jane Doe (seeded)',
	maskedLabel: 'Full Name',
	maskedField: 'fullName',
	maskedSeedValue: 'Jane Doe',
	emailField: 'contactEmail',
	emailSeedValue: 'jane.doe@example.com',
	plainField: 'notes',
	plainSeedValue: 'Visible input, encrypted at rest. Check the DB to verify.',
	richTextLabel: 'Private Notes',
}

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(res.ok()).toBeTruthy()
}

const openShowcaseDoc = async (page: Page): Promise<void> => {
	const res = await page.request.get(
		`/api/${FIXTURES.collection}?where[label][equals]=${encodeURIComponent(FIXTURES.docTitle)}&limit=1`
	)
	const { docs } = (await res.json()) as { docs: { id: string }[] }
	const doc = docs[0]
	if (!doc) throw new Error(`no ${FIXTURES.collection} doc labelled ${FIXTURES.docTitle}`)
	await page.goto(`/admin/collections/${FIXTURES.collection}/${doc.id}`)
	await expect(page.locator(`#field-${FIXTURES.plainField}`)).toBeVisible()
}

const protectedField = (page: Page, label: string): Locator =>
	page.locator('.tenx-protected-field').filter({ hasText: label })

const saveDoc = async (page: Page): Promise<void> => {
	const saved = page.waitForResponse(
		(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
	)
	await page.locator('#action-save').click()
	expect((await saved).ok()).toBeTruthy()
}

test.describe('encrypted field', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('masks by default, reveals the decrypted value, and conceals again', async ({ page }) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.maskedLabel)
		await expect(field.locator('.tenx-protected-field__mask')).toBeVisible()
		await expect(page.locator(`#field-${FIXTURES.maskedField}`)).toHaveCount(0)

		await field.getByRole('button', { name: 'Reveal' }).click()
		const input = page.locator(`#field-${FIXTURES.maskedField}`)
		await expect(input).toBeVisible()
		await expect(input).toHaveValue(FIXTURES.maskedSeedValue)

		await field.getByRole('button', { name: 'Conceal' }).click()
		await expect(field.locator('.tenx-protected-field__mask')).toBeVisible()
		await expect(page.locator(`#field-${FIXTURES.maskedField}`)).toHaveCount(0)
	})

	test('edits a revealed value and round-trips through encryption', async ({ page }) => {
		await openShowcaseDoc(page)
		const rotated = 'rotated-secret-99'
		await protectedField(page, FIXTURES.maskedLabel).getByRole('button', { name: 'Reveal' }).click()
		await page.locator(`#field-${FIXTURES.maskedField}`).fill(rotated)
		await saveDoc(page)

		await page.reload()
		await protectedField(page, FIXTURES.maskedLabel).getByRole('button', { name: 'Reveal' }).click()
		await expect(page.locator(`#field-${FIXTURES.maskedField}`)).toHaveValue(rotated)

		await page.locator(`#field-${FIXTURES.maskedField}`).fill(FIXTURES.maskedSeedValue)
		await saveDoc(page)
	})

	test('list view masks encrypted cells and never leaks plaintext', async ({ page }) => {
		await page.goto(`/admin/collections/${FIXTURES.collection}`)
		await expect(page.locator(`.cell-${FIXTURES.maskedField}`).first()).toBeVisible()
		await expect(
			page.locator(`.cell-${FIXTURES.maskedField} .tenx-protected-cell`).first()
		).toBeVisible()
		await expect(
			page.locator(`.cell-${FIXTURES.emailField} .tenx-protected-cell`).first()
		).toBeVisible()
		await expect(page.locator(`.cell-${FIXTURES.plainField}`).first()).toContainText(
			FIXTURES.plainSeedValue
		)
		const body = await page.locator('body').innerText()
		expect(body).not.toContain(FIXTURES.emailSeedValue)
	})

	test('protection none renders a native input with the value visible', async ({ page }) => {
		await openShowcaseDoc(page)
		const input = page.locator(`#field-${FIXTURES.plainField}`)
		await expect(input).toBeVisible()
		await expect(input).toHaveValue(FIXTURES.plainSeedValue)
		await expect(input).toBeEditable()
		const row = page.locator('.field-type').filter({ has: input })
		await expect(row.locator('.tenx-protected-field__mask')).toHaveCount(0)
	})

	test('rich text reveals a read-only json view with an api-only notice', async ({ page }) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.richTextLabel)
		await field.getByRole('button', { name: 'Reveal' }).click()
		await expect(field.locator('.tenx-protected-field__json')).toBeVisible()
		await expect(field.locator('.tenx-protected-field__notice')).toContainText(/read-only/i)
	})

	test('protected fields have no serious or critical axe violations', async ({ page }) => {
		await openShowcaseDoc(page)
		const richText = protectedField(page, FIXTURES.richTextLabel)
		await richText.getByRole('button', { name: 'Reveal' }).click()
		await expect(richText.locator('.tenx-protected-field__json')).toBeVisible()
		const results = await new AxeBuilder({ page }).include('.tenx-protected-field').analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})
})
