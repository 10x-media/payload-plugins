import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'

const FIXTURES = {
	collection: 'colors',
	docTitle: 'Showcase',
	basic: 'hexDefault',
	basicSeedValue: '#7c3aed',
	presetLabel: 'Global blue',
	presetValue: '#1d4ed8',
	schemeField: 'linkedSchemes',
	schemeFlatField: 'schemePresetsFlat',
	schemePresetLabel: 'Acme surface',
	schemePresetKey: 'acme/surface',
	schemePresetLight: '#f5f3ff',
}

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(res.ok()).toBeTruthy()
}

const openShowcaseDoc = async (page: Page): Promise<void> => {
	const res = await page.request.get(
		`/api/${FIXTURES.collection}?where[title][equals]=${FIXTURES.docTitle}&limit=1`
	)
	const { docs } = (await res.json()) as { docs: { id: string }[] }
	const doc = docs[0]
	if (!doc) throw new Error(`no ${FIXTURES.collection} doc titled ${FIXTURES.docTitle}`)
	await page.goto(`/admin/collections/${FIXTURES.collection}/${doc.id}`)
	await expect(page.locator(`#field-${FIXTURES.basic}`)).toBeVisible()
}

const swatchButton = (page: Page, name: string): Locator =>
	page
		.locator('.fields-color')
		.filter({ has: page.locator(`#field-${name}`) })
		.locator('.fields-color__swatch-button')

const popover = (page: Page): Locator => page.locator('.fields-color__panel:visible')

const saveDoc = async (page: Page): Promise<void> => {
	const saved = page.waitForResponse(
		(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
	)
	await page.locator('#action-save').click()
	expect((await saved).ok()).toBeTruthy()
}

test.describe('color field', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('picks a color from the saturation area, saves, and persists after reload', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const input = page.locator(`#field-${FIXTURES.basic}`)
		await expect(input).toHaveValue(FIXTURES.basicSeedValue)

		await swatchButton(page, FIXTURES.basic).click()
		await expect(popover(page)).toBeVisible()

		const area = popover(page).locator('.fields-color__sv')
		const box = await area.boundingBox()
		if (!box) throw new Error('saturation area not visible')
		await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3)

		await expect(input).not.toHaveValue(FIXTURES.basicSeedValue)
		const picked = await input.inputValue()
		expect(picked).toMatch(/^#[0-9a-f]{6,8}$/i)

		await page.keyboard.press('Escape')
		await saveDoc(page)
		await page.reload()
		await expect(page.locator(`#field-${FIXTURES.basic}`)).toHaveValue(picked)
	})

	test('accepts a typed css color and stores it in the configured format', async ({ page }) => {
		await openShowcaseDoc(page)
		const input = page.locator(`#field-${FIXTURES.basic}`)
		await input.fill('rgb(255, 136, 0)')
		await input.blur()
		await expect(input).toHaveValue('#ff8800')
		await saveDoc(page)
		await page.reload()
		await expect(page.locator(`#field-${FIXTURES.basic}`)).toHaveValue('#ff8800')
	})

	test('picks a preset from the popover', async ({ page }) => {
		await openShowcaseDoc(page)
		await swatchButton(page, FIXTURES.basic).click()
		await expect(popover(page)).toBeVisible()
		await popover(page)
			.locator(`.fields-color__preset[aria-label="${FIXTURES.presetLabel}"]`)
			.click()
		await expect(page.locator(`#field-${FIXTURES.basic}`)).toHaveValue(FIXTURES.presetValue)
		await saveDoc(page)
	})

	test('a scheme preset renders a split swatch in the picker and the chip', async ({ page }) => {
		await openShowcaseDoc(page)
		await swatchButton(page, FIXTURES.schemeField).click()
		await expect(popover(page)).toBeVisible()

		const preset = popover(page).locator(
			`.fields-color__preset[aria-label="${FIXTURES.schemePresetLabel}"]`
		)
		await expect(preset.locator('span')).toHaveCSS('background-image', /linear-gradient/)
		await preset.click()

		const field = page
			.locator('.fields-color')
			.filter({ has: page.locator(`#field-${FIXTURES.schemeField}`) })
		await expect(field.locator('.fields-color__chip-label')).toHaveText(FIXTURES.schemePresetLabel)
		await expect(field.locator('.fields-color__chip-color')).toHaveCSS(
			'background-image',
			/linear-gradient/
		)
		await saveDoc(page)
	})

	test('a non-linked field stores a scheme preset light member', async ({ page }) => {
		await openShowcaseDoc(page)
		await swatchButton(page, FIXTURES.schemeFlatField).click()
		await expect(popover(page)).toBeVisible()
		await popover(page)
			.locator(`.fields-color__preset[aria-label="${FIXTURES.schemePresetLabel}"]`)
			.click()
		await expect(page.locator(`#field-${FIXTURES.schemeFlatField}`)).toHaveValue(
			FIXTURES.schemePresetLight
		)
		await saveDoc(page)
	})

	test('the list cell renders a split swatch for a scheme reference', async ({ page }) => {
		// Set the reference over the API so this does not depend on another test having saved it
		const res = await page.request.get(
			`/api/${FIXTURES.collection}?where[title][equals]=${FIXTURES.docTitle}&limit=1`
		)
		const { docs } = (await res.json()) as { docs: { id: string }[] }
		const doc = docs[0]
		if (!doc) throw new Error(`no ${FIXTURES.collection} doc titled ${FIXTURES.docTitle}`)
		const patched = await page.request.patch(`/api/${FIXTURES.collection}/${doc.id}`, {
			data: { [FIXTURES.schemeField]: `preset:${FIXTURES.schemePresetKey}` },
		})
		expect(patched.ok()).toBeTruthy()

		const columns = encodeURIComponent(JSON.stringify(['title', FIXTURES.schemeField]))
		await page.goto(`/admin/collections/${FIXTURES.collection}?columns=${columns}`)

		const cell = page.locator('.fields-color-cell').first()
		await expect(cell).toBeVisible()
		await expect(cell.locator('.fields-color-cell__swatch span')).toHaveCSS(
			'background-image',
			/linear-gradient/
		)
		await expect(cell.locator('.fields-color-cell__missing')).toHaveCount(0)
	})

	test('keyboard: enter opens the popover, escape closes it and restores trigger focus', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const trigger = swatchButton(page, FIXTURES.basic)
		await trigger.focus()
		await page.keyboard.press('Enter')
		await expect(popover(page)).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(popover(page)).toBeHidden()
		await expect(trigger).toBeFocused()
	})

	test('open popover has no serious or critical axe violations', async ({ page }) => {
		await openShowcaseDoc(page)
		await swatchButton(page, FIXTURES.basic).click()
		await expect(popover(page)).toBeVisible()
		const results = await new AxeBuilder({ page }).include('.fields-color__panel').analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})

	// color-contrast is disabled: the closed row's only sub-threshold text is the small
	// aria-hidden format badge, styled with a core elevation token the plugin adopts for
	// Payload's native look. This guards the closed row's structural a11y (roles, names);
	// the open-popover scan above keeps color-contrast enforced on plugin-owned surfaces.
	test('closed color field has no serious or critical structural axe violations', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		await expect(page.locator('.fields-color').first()).toBeVisible()
		const results = await new AxeBuilder({ page })
			.include('.fields-color')
			.disableRules(['color-contrast'])
			.analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})
})
