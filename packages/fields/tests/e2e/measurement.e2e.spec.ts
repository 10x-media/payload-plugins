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

// One kebab per field, scalar or compound, is the only unit trigger today; .first()
// is defensive rather than load-bearing, so a future layout adding a second trigger
// still resolves to a single match under Playwright's strict mode.
const unitBadge = (page: Page, name: string) =>
	page
		.locator('.fields-measurement')
		.filter({ has: page.locator(`#field-${name}`) })
		.locator('.fields-measurement__unit-trigger')
		.first()

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

	test('the dirty guard: a readable-mode draft can paint truncated, but an untouched input never commits it', async ({
		page,
	}) => {
		const id = await openShowcaseDoc(page)
		await pickUnit(page, 'height', /^in$/i)
		await page.locator('#field-height').fill('71')
		const saved = page.waitForResponse(
			(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
		)
		await page.locator('#action-save').click()
		expect((await saved).ok()).toBeTruthy()
		await pickUnit(page, 'height', /^cm$/i)
		// personHeight's cm display digits are 1 (precision.display.cm), and readable
		// mode's default draft policy is 'display' (no faithful escalation), so the
		// stored 180.34 paints as the truncated 180.3, not the full-precision value.
		await expect(page.locator('#field-height')).toHaveValue('180.3')
		// Switching the display unit never calls setValue (it only updates the saved
		// preference), so the form stays unmodified and Payload's own SaveButton stays
		// disabled: there is no code path yet that could resave a truncated draft.
		await expect(page.locator('#action-save')).toBeDisabled()
		// Dirty an unrelated field (reverted before saving, so the doc premise holds for
		// later tests) to force a real resave: this carries the untouched, truncated-looking
		// height draft through a full-document PATCH alongside unrelated churn, not just the
		// isolated commit above. The dirty guard means the height input was never typed into,
		// so it commits the exact stored value, never the '180.3' it happens to display.
		const nativeInput = page.locator('#field-nativeNumber')
		const originalNative = await nativeInput.inputValue()
		await nativeInput.fill('42')
		await nativeInput.fill(originalNative)
		await expect(page.locator('#action-save')).toBeEnabled()
		const resaved = page.waitForResponse(
			(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
		)
		await page.locator('#action-save').click()
		expect((await resaved).ok()).toBeTruthy()
		const res = await page.request.get(`/api/${FIXTURES.collection}/${id}`)
		const doc = (await res.json()) as { height: number }
		expect(doc.height).toBeCloseTo(180.34, 6)
	})

	test('exact mode paints a faithful full-precision draft, never a rounded preview', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		// labSample (mass, precision: 'exact') is seeded at 12.345678 kg: exact mode's
		// draft policy escalates fraction digits until the draft round-trips the exact
		// stored value, so the input shows the full value rather than kg's 1-digit
		// readable-mode display precision. Pin the display unit to kg (the storage
		// unit) so the assertion is independent of locale-based unit resolution.
		await pickUnit(page, 'labSample', /^kg$/i)
		await expect(page.locator('#field-labSample')).toHaveValue('12.345678')
	})

	test('quantize rounds a typed value at display digits, in the entry unit, before it commits', async ({
		page,
	}) => {
		const id = await openShowcaseDoc(page)
		// distance has no field-level precision override, so it runs readable mode's
		// default: entry 'quantize'. km displays at 1 digit, so 71.437 quantizes to
		// 71.4 in the entry unit before converting (here a no-op conversion, since the
		// storage unit is also km) rather than committing the raw typed value.
		await pickUnit(page, 'distance', /^km$/i)
		await page.locator('#field-distance').fill('71.437')
		const saved = page.waitForResponse(
			(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
		)
		await page.locator('#action-save').click()
		expect((await saved).ok()).toBeTruthy()
		const res = await page.request.get(`/api/${FIXTURES.collection}/${id}`)
		const doc = (await res.json()) as { distance: number }
		expect(doc.distance).toBeCloseTo(71.4, 6)
	})

	test('clicking dead space in a scalar container focuses its input', async ({ page }) => {
		await openShowcaseDoc(page)
		const container = page
			.locator('.fields-measurement')
			.filter({ has: page.locator('#field-weight') })
			.locator('.fields-measurement__container')
		const box = await container.boundingBox()
		if (!box) throw new Error('weight container has no bounding box')
		// The kebab trigger is flush against the right edge (8px container padding
		// plus its own 24px width, so it owns the rightmost ~32px); the horizontal
		// midpoint sits well clear of both the value/unit phrase on the left and the
		// trigger on the right, landing on genuine dead space.
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
		await expect(page.locator('#field-weight')).toBeFocused()
		// If the click had landed on the trigger instead, a panel would be visible
		// (every field's panel stays mounted, toggling only :visible) and the test
		// would pass for the wrong reason; assert none opened.
		await expect(page.locator('.fields-measurement__unit-panel:visible')).toHaveCount(0)
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
	// unit chip label and compound suffix chip, styled with a core elevation token the
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
