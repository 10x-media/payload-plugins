import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { MEASUREMENT_PREFERENCE_KEY } from '../../src/exports/measurement'

const FIXTURES = { collection: 'measurements', docTitle: 'Showcase' }

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(res.ok()).toBeTruthy()
}

const openShowcaseDoc = async (page: Page): Promise<string> => {
	const res = await page.request.get(
		`/api/${FIXTURES.collection}?where[title][equals]=${FIXTURES.docTitle}&limit=1`
	)
	const { docs } = (await res.json()) as { docs: { id: string }[] }
	const doc = docs[0]
	if (!doc) throw new Error('no measurements Showcase doc')
	await page.goto(`/admin/collections/${FIXTURES.collection}/${doc.id}`)
	await expect(page.locator('#field-weight')).toBeVisible()
	return doc.id
}

const unitBadge = (page: Page, name: string) =>
	page
		.locator('.fields-measurement')
		.filter({ has: page.locator(`#field-${name}`) })
		.locator('.fields-measurement__unit-button')

// The unit menu can hold both a scalar and a compound sharing the same substring
// (e.g. "lb" and "st lb"), so options are matched by the short-symbol span's exact
// text rather than a loose regex against the long label, which Playwright strict
// mode would otherwise reject as ambiguous.
const pickUnit = async (page: Page, name: string, shortLabel: RegExp): Promise<void> => {
	await unitBadge(page, name).click()
	await page
		.locator('.fields-measurement__unit-option:visible')
		.filter({ has: page.locator('.fields-measurement__unit-symbol', { hasText: shortLabel }) })
		.click()
}

test.describe('measurement field', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	// Preference cleanup must survive a failing test, so it lives here rather
	// than as trailing toggles inside each test.
	test.afterEach(async ({ page }) => {
		await page.request.delete(`/api/payload-preferences/${MEASUREMENT_PREFERENCE_KEY}`)
	})

	test('toggling one bodyWeight field flips its siblings and persists across reload', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		await pickUnit(page, 'weight', /^lb$/i)
		await expect(page.locator('#field-weight')).toHaveValue('180')
		await expect(unitBadge(page, 'boundedWeight')).toContainText(/lb/i)
		await expect(unitBadge(page, 'height')).not.toContainText(/lb/i)
		await page.reload()
		await expect(page.locator('#field-weight')).toHaveValue('180')
	})

	test('compound ft-in entry stores canonical centimeters', async ({ page }) => {
		const id = await openShowcaseDoc(page)
		await pickUnit(page, 'height', /^ft in$/i)
		const container = page
			.locator('.fields-measurement')
			.filter({ has: page.locator('#field-height') })
		await expect(container.locator('input')).toHaveCount(2)
		await container.locator('input').first().fill('6')
		await container.locator('input').nth(1).fill('2')
		const saved = page.waitForResponse(
			(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
		)
		await page.locator('#action-save').click()
		expect((await saved).ok()).toBeTruthy()
		const res = await page.request.get(`/api/${FIXTURES.collection}/${id}`)
		const doc = (await res.json()) as { height: number }
		expect(doc.height).toBeCloseTo(187.96, 1)
	})

	test('list cells render the preferred unit', async ({ page }) => {
		await openShowcaseDoc(page)
		await pickUnit(page, 'weight', /^lb$/i)
		const columns = encodeURIComponent(JSON.stringify(['title', 'weight']))
		await page.goto(`/admin/collections/${FIXTURES.collection}?columns=${columns}`)
		await expect(page.locator('.fields-measurement-cell').first()).toContainText(/lb/i)
	})

	test('scalar and compound rows match the native number field height', async ({ page }) => {
		await openShowcaseDoc(page)
		const nativeBox = await page.locator('#field-nativeNumber').boundingBox()
		const container = (name: string) =>
			page
				.locator('.fields-measurement')
				.filter({ has: page.locator(`#field-${name}`) })
				.locator('.fields-measurement__container')
		const scalarBox = await container('weight').boundingBox()
		await pickUnit(page, 'height', /^ft in$/i)
		const compoundBox = await container('height').boundingBox()
		for (const box of [scalarBox, compoundBox]) {
			expect(box?.height).toBeGreaterThanOrEqual(39)
			expect(box?.height).toBeLessThanOrEqual(41)
		}
		expect(scalarBox?.height).toBe(nativeBox?.height)
		expect(compoundBox?.height).toBe(nativeBox?.height)
	})

	test('open unit panel has no serious or critical axe violations', async ({ page }) => {
		await openShowcaseDoc(page)
		await unitBadge(page, 'weight').click()
		const panel = page.locator('.fields-measurement__unit-panel:visible')
		await expect(panel).toBeVisible()
		const results = await new AxeBuilder({ page })
			.include('.fields-measurement__unit-panel')
			.analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})

	// color-contrast is disabled: the closed row's only sub-threshold text is the small
	// uppercase unit badge and compound suffix, styled with a core elevation token the
	// plugin adopts for Payload's native look. This guards the closed row's structural
	// a11y (roles, names); the open-panel scan above keeps color-contrast enforced on
	// plugin-owned surfaces.
	test('closed measurement field has no serious or critical structural axe violations', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const results = await new AxeBuilder({ page })
			.include('.fields-measurement')
			.disableRules(['color-contrast'])
			.analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'critical' || v.impact === 'serious'
		)
		expect(blocking).toEqual([])
	})
})
