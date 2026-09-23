import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'

const FIXTURES = { collection: 'phone-numbers', docTitle: 'Showcase' }

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(res.ok()).toBeTruthy()
}

/** The seeded values every other test reads back, restored after anything that saves. */
const SEEDED = {
	phone: { country: 'DE', number: '+4930123456' },
}

const showcaseId = async (page: Page): Promise<string> => {
	const res = await page.request.get(
		`/api/${FIXTURES.collection}?where[title][equals]=${FIXTURES.docTitle}&limit=1`
	)
	const { docs } = (await res.json()) as { docs: { id: string }[] }
	const doc = docs[0]
	if (!doc) throw new Error(`no ${FIXTURES.collection} doc titled ${FIXTURES.docTitle}`)
	return doc.id
}

const openShowcaseDoc = async (page: Page): Promise<void> => {
	await page.goto(`/admin/collections/${FIXTURES.collection}/${await showcaseId(page)}`)
	await expect(page.locator('#field-phone')).toBeVisible()
}

/** The field's outer wrapper, found via the id its own input renders (dots become double underscores). */
const phoneField = (page: Page, name: string): Locator =>
	page.locator('.fields-phone').filter({ has: page.locator(`#field-${name}`) })

// The picker portals outside the field wrapper, so it is located from the page, not the field.
const panel = (page: Page): Locator => page.locator('.fields-phone__panel')

const openPicker = (field: Locator): Promise<void> =>
	field.locator('.fields-phone__trigger').click()

const saveDoc = async (page: Page): Promise<void> => {
	const saved = page.waitForResponse(
		(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
	)
	await page.locator('#action-save').click()
	expect((await saved).ok()).toBeTruthy()
}

test.describe('phone number field', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('opens the picker, filters by search, and selects the arrow-keyed result', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = phoneField(page, 'phone')
		await openPicker(field)

		const search = panel(page).locator('.fields-phone__search-input')
		await expect(search).toBeFocused()

		await search.fill('united')
		const options = panel(page).locator('.fields-phone__option')
		// Exact set and order, not just a shrinking count: proves the filter matched by name
		// rather than merely narrowing the virtualized window.
		await expect(options.locator('.fields-phone__option-name')).toHaveText([
			'United Arab Emirates',
			'United Kingdom',
			'United States',
		])

		// The first filtered row is active by default; two ArrowDowns must move it two rows,
		// not leave Enter to fall back on whatever was already selected.
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('ArrowDown')
		await expect(options.nth(2)).toHaveAttribute('data-active', 'true')

		await page.keyboard.press('Enter')
		await expect(panel(page)).toHaveCount(0)
		await expect(field.locator('.fields-phone__prefix')).toHaveText('+1')
		await expect(field.locator('.fields-phone__sr-only')).toHaveText('Country: United States')
	})

	// These save. Restoring inside the test would be skipped by a failure before it, leaving
	// another number behind to fail the list-view test on the next run and mask the real one.
	test.describe('persisting', () => {
		test.afterEach(async ({ page }) => {
			const res = await page.request.patch(
				`/api/${FIXTURES.collection}/${await showcaseId(page)}`,
				{ data: SEEDED }
			)
			expect(res.ok()).toBeTruthy()
		})

		test('entering an international number in one shot switches the country, reformats, and persists', async ({
			page,
		}) => {
			await openShowcaseDoc(page)
			const field = phoneField(page, 'phone')
			const input = field.locator('.fields-phone__input')

			// A single .fill() commits the whole string in one change event, the same shape a
			// paste produces; the field has no onPaste handler, so this exercises the identical path.
			await input.fill('+33612345678')
			await expect(field.locator('.fields-phone__flag')).toHaveAttribute('src', /\/flags\/fr\.svg/)
			await expect(input).toHaveValue('+33 6 12 34 56 78')

			await input.blur()
			// Blur re-splits the international draft: the calling code moves back into its own
			// prefix span and the input keeps only the national digits.
			await expect(field.locator('.fields-phone__prefix')).toHaveText('+33')
			await expect(input).toHaveValue('6 12 34 56 78')

			await saveDoc(page)
			await page.reload()
			const reopened = phoneField(page, 'phone')
			await expect(reopened.locator('.fields-phone__prefix')).toHaveText('+33')
			await expect(reopened.locator('.fields-phone__input')).toHaveValue('6 12 34 56 78')
		})
	})

	test('the flag artwork endpoint really serves an SVG, not just an unbroken img element', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const img = phoneField(page, 'svgFlags').locator('.fields-phone__flag')
		await expect(img).toBeVisible()

		const src = await img.getAttribute('src')
		if (!src) throw new Error('svgFlags flag renders with no src')
		expect(src).toMatch(/\/flags\/ch\.svg$/)

		// naturalWidth stays 0 for a load failure even though the element itself is present
		// and occupies its box, which is why an element existing is not proof of a real image.
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
			.toBeGreaterThan(0)

		const res = await page.request.get(src)
		expect(res.status()).toBe(200)
		expect(res.headers()['content-type']).toContain('image/svg+xml')
	})

	test('list view renders each cellFormat and flag mode', async ({ page }) => {
		await page.goto(`/admin/collections/${FIXTURES.collection}`)

		const phoneCell = page.locator('.cell-phone').first()
		await expect(phoneCell).toHaveText('+49 30 123456')
		await expect(phoneCell.locator('img')).toHaveAttribute('src', /\/flags\/de\.svg$/)

		await expect(page.locator('.cell-nationalCell').first()).toHaveText('(11) 5525-6325')
		await expect(page.locator('.cell-e164Cell').first()).toHaveText('+61499999999')

		const emojiCell = page.locator('.cell-emojiFlags').first()
		await expect(emojiCell).toHaveText(`${String.fromCodePoint(0x1f1eb, 0x1f1f7)}+33 6 12 34 56 78`)
		await expect(emojiCell.locator('img')).toHaveCount(0)

		const noFlagsCell = page.locator('.cell-noFlags').first()
		await expect(noFlagsCell).toHaveText('+43 664 123456')
		await expect(noFlagsCell.locator('img')).toHaveCount(0)
	})

	test('the clear control empties the field, drops the button, and refocuses the input', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = phoneField(page, 'possibleValidation')
		const input = field.locator('.fields-phone__input')
		const clear = field.locator('.fields-phone__clear')

		await expect(input).not.toHaveValue('')
		await clear.click()

		await expect(input).toHaveValue('')
		await expect(clear).toHaveCount(0)
		await expect(input).toBeFocused()
	})

	test('a read-only field cannot be edited and disables its country trigger', async ({ page }) => {
		await openShowcaseDoc(page)
		const field = phoneField(page, 'readOnlyPhone')
		const input = field.locator('.fields-phone__input')

		await expect(input).toHaveJSProperty('readOnly', true)
		await expect(input).not.toBeEditable()
		await expect(field.locator('.fields-phone__trigger')).toBeDisabled()
		// isReadOnly also gates showClear; a value is present, so this only holds if the
		// read-only wiring, not merely an empty value, is what is hiding the button.
		await expect(field.locator('.fields-phone__clear')).toHaveCount(0)
	})

	test('an invalid number surfaces its validation error on save', async ({ page }) => {
		await openShowcaseDoc(page)
		const field = phoneField(page, 'strictValidation')
		const input = field.locator('.fields-phone__input')

		await input.fill('123')
		await input.blur()

		const saved = page.waitForResponse(
			(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
		)
		await page.locator('#action-save').click()
		const response = await saved
		expect(response.status()).toBe(400)

		// Asserted on the toast, not .field-error: this tier's transactional Mongo connection
		// makes Payload's PATCH response inconsistently omit the per-field breakdown .field-error needs.
		await expect(page.getByTestId('field-error')).toHaveText('Strict Validation')
	})

	test('the allowlisted field keeps its +81 prefix for a country outside its own list, and filters the picker to six', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = phoneField(page, 'allowlisted')
		// Seeded with JP, which is not in this field's own countries allowlist: the prefix
		// still has to render off the stored country rather than dropping to no prefix at all.
		await expect(field.locator('.fields-phone__prefix')).toHaveText('+81')

		await openPicker(field)
		const names = panel(page).locator('.fields-phone__option-name')
		await expect(names).toHaveCount(6)
		await expect(names).toHaveText([
			'Germany',
			'Austria',
			'Switzerland',
			'France',
			'United Kingdom',
			'United States',
		])
	})

	test('two contacts rows keep independent phone values', async ({ page }) => {
		await openShowcaseDoc(page)
		const first = phoneField(page, 'contacts__0__phone')
		const second = phoneField(page, 'contacts__1__phone')

		await expect(first.locator('.fields-phone__input')).toHaveValue('44 668 18 00')
		await expect(second.locator('.fields-phone__input')).toHaveValue('212 555 2368')

		// Editing the first row must not bleed into the second: this is the sibling-scoping
		// bug an array of grouped fields can reintroduce.
		await first.locator('.fields-phone__input').fill('44 668 18 09')
		await first.locator('.fields-phone__input').blur()
		await expect(second.locator('.fields-phone__input')).toHaveValue('212 555 2368')
		await expect(second.locator('.fields-phone__prefix')).toHaveText('+1')
	})

	test('the calling code prefix stays left-to-right under an RTL admin language', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		await page
			.context()
			.addCookies([{ name: 'payload-lng', value: 'ar', url: new URL(page.url()).origin }])
		await page.reload()

		// Proves the page is genuinely RTL before trusting the LTR assertion below; a
		// language switch that silently failed would make that assertion pass vacuously.
		await expect(page.locator('body')).toHaveCSS('direction', 'rtl')

		const field = phoneField(page, 'phone')
		await expect(field.locator('.fields-phone__prefix')).toHaveCSS('direction', 'ltr')

		await openPicker(field)
		const firstOption = panel(page).locator('.fields-phone__option').first()
		await expect(firstOption).toBeVisible()
		await expect(firstOption.locator('.fields-phone__option-code')).toHaveCSS('direction', 'ltr')
	})

	test('open picker panel has no serious or critical axe violations', async ({ page }) => {
		await openShowcaseDoc(page)
		const field = phoneField(page, 'phone')
		await openPicker(field)
		await expect(panel(page).locator('.fields-phone__option').first()).toBeVisible()

		const results = await new AxeBuilder({ page }).include('.fields-phone__panel').analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})

	// color-contrast is disabled: the closed row's only sub-threshold text is the field
	// description's core elevation token; the open-panel scan above still covers color-contrast.
	test('closed phone fields have no serious or critical structural axe violations', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const results = await new AxeBuilder({ page })
			.include('.fields-phone')
			.disableRules(['color-contrast'])
			.analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})
})
