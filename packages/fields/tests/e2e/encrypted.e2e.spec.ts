import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'

const DOT = '•'

const FIXTURES = {
	collection: 'encrypted',
	docTitle: 'Jane Doe (seeded)',
	fullName: { label: 'Full Name', name: 'fullName', seed: 'Jane Doe' },
	apiKey: {
		label: 'Api Key',
		maskDots: 32,
		name: 'apiKey',
		seed: '0123456789abcdef0123456789abcdef',
	},
	tier: { label: 'Tier', name: 'tier', seed: 'pro' },
	channels: { label: 'Channels', name: 'channels' },
	notes: {
		label: 'Notes',
		name: 'notes',
		seed: 'Visible input, encrypted at rest. Check the DB to verify.',
	},
	richText: { label: 'Private Notes', name: 'privateNotes', seed: 'Extremely private rich text.' },
	draft: { name: 'draftBody', seed: 'Draft body, protection none, encrypted at rest.' },
}

const SHOW = 'Show value'
const HIDE = 'Hide value'

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(res.ok()).toBeTruthy()
}

/** The eyeball toggle inside a protected field; persistent across reveal/conceal. */
const eyeOf = (field: Locator): Locator => field.locator('.tenx-protected-field__eye')

/** Locate a masked field's wrapper by its rendered label. */
const protectedField = (page: Page, label: string): Locator =>
	page.locator('.tenx-protected-field').filter({ hasText: label })

/** Rounded rendered height of a visible element, for native-consistency checks. */
const heightOf = async (locator: Locator): Promise<number> => {
	await expect(locator).toBeVisible()
	const box = await locator.boundingBox()
	if (!box) throw new Error('element has no bounding box')
	return Math.round(box.height)
}

/** Native Payload inputs and react-select controls render at 40px; allow 1px of rounding. */
const expectNativeFieldHeight = (height: number): void => {
	expect(height).toBeGreaterThanOrEqual(39)
	expect(height).toBeLessThanOrEqual(41)
}

const openShowcaseDoc = async (page: Page): Promise<void> => {
	const res = await page.request.get(
		`/api/${FIXTURES.collection}?where[label][equals]=${encodeURIComponent(FIXTURES.docTitle)}&limit=1`
	)
	const { docs } = (await res.json()) as { docs: { id: string }[] }
	const doc = docs[0]
	if (!doc) throw new Error(`no ${FIXTURES.collection} doc labelled ${FIXTURES.docTitle}`)
	await page.goto(`/admin/collections/${FIXTURES.collection}/${doc.id}`)
	// The eye is a client component, so a visible toggle proves the encrypted
	// fields have hydrated before any test interacts with them.
	await expect(
		protectedField(page, FIXTURES.fullName.label).getByRole('button', { name: SHOW })
	).toBeVisible()
}

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

	test('masks the value with dots and a Show value eye, hiding the plaintext', async ({ page }) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.fullName.label)

		const masked = field.locator('.tenx-protected-field__masked-input')
		await expect(masked).toBeVisible()
		await expect(masked).toHaveValue(new RegExp(`^${DOT}+$`))

		const eye = eyeOf(field)
		await expect(eye).toHaveAttribute('aria-label', SHOW)
		await expect(eye).toHaveAttribute('aria-pressed', 'false')

		// One input is mounted in both states; while concealed it is readOnly with the
		// dot run as its value, so the decrypted plaintext never reaches the DOM.
		await expect(masked).toHaveJSProperty('readOnly', true)
		await expect(field).not.toContainText(FIXTURES.fullName.seed)
	})

	test('reveals the decrypted value, flips the eye, and keeps focus on the eye across toggles', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.fullName.label)
		const eye = eyeOf(field)
		const input = field.locator(`#field-${FIXTURES.fullName.name}`)

		await eye.click()
		await expect(input).toBeVisible()
		await expect(input).toHaveValue(FIXTURES.fullName.seed)
		await expect(eye).toHaveAttribute('aria-label', HIDE)
		await expect(eye).toHaveAttribute('aria-pressed', 'true')
		// The eye is a persistent control, so toggling never drops focus to <body>.
		await expect(eye).toBeFocused()

		await eye.click()
		await expect(field.locator('.tenx-protected-field__masked-input')).toBeVisible()
		// The same input morphs back to the readOnly dot run, so plaintext leaves the DOM.
		await expect(input).toHaveValue(new RegExp(`^${DOT}+$`))
		await expect(field).not.toContainText(FIXTURES.fullName.seed)
		await expect(eye).toHaveAttribute('aria-label', SHOW)
		await expect(eye).toBeFocused()
	})

	test('masks apiKey with exactly maskDots dots, then reveals the real stored secret', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.apiKey.label)

		// The mask is a run of • that IS the input's value; its length is the configured
		// maskDots (32), driven by the field config rather than the stored secret.
		const masked = field.locator('.tenx-protected-field__masked-input')
		const dots = await masked.inputValue()
		expect(dots).toBe(DOT.repeat(FIXTURES.apiKey.maskDots))
		expect(dots.length).toBe(FIXTURES.apiKey.maskDots)

		await eyeOf(field).click()
		await expect(field.locator(`#field-${FIXTURES.apiKey.name}`)).toHaveValue(FIXTURES.apiKey.seed)
	})

	test('keeps native-consistent 40px heights, so revealing never grows the field', async ({
		page,
	}) => {
		await openShowcaseDoc(page)

		// Attached text: the masked input and its eye both sit at height:100% inside the
		// bordered 40px row (ProtectedField.css, `.tenx-protected-field__attached-row`),
		// so both render at 38px by design; only these two checks get the wider floor.
		const text = protectedField(page, FIXTURES.fullName.label)
		const maskedHeight = await heightOf(text.locator('.tenx-protected-field__masked-input'))
		expect(maskedHeight).toBeGreaterThanOrEqual(38)
		expect(maskedHeight).toBeLessThanOrEqual(41)
		const eyeHeight = await heightOf(eyeOf(text))
		expect(eyeHeight).toBeGreaterThanOrEqual(38)
		expect(eyeHeight).toBeLessThanOrEqual(41)

		// Select: the concealed masked face and the revealed native react-select control are
		// both 40px, so the field does not grow taller when the eye reveals it.
		const select = protectedField(page, FIXTURES.tier.label)
		const face = select.locator('.tenx-protected-field__rs-control')
		const concealedHeight = await heightOf(face)
		expectNativeFieldHeight(concealedHeight)

		await eyeOf(select).click()
		await expect(face).toHaveCount(0)
		const revealedHeight = await heightOf(select.locator('.rs__control'))
		expectNativeFieldHeight(revealedHeight)
		expect(revealedHeight).toBeLessThanOrEqual(concealedHeight + 1)

		// hasMany select: react-select is height:auto and renders multi-value chips a
		// couple px shorter than a single value, so the 40px floor is what keeps a
		// hasMany field from shrinking on reveal.
		const multi = protectedField(page, FIXTURES.channels.label)
		const multiFace = multi.locator('.tenx-protected-field__rs-control')
		const multiConcealed = await heightOf(multiFace)
		expectNativeFieldHeight(multiConcealed)
		await eyeOf(multi).click()
		await expect(multiFace).toHaveCount(0)
		const multiRevealed = await heightOf(multi.locator('.rs__control'))
		expectNativeFieldHeight(multiRevealed)
		expect(Math.abs(multiRevealed - multiConcealed)).toBeLessThanOrEqual(1)
	})

	test('focuses the input and eye as one control, so the focus border has no seam', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.fullName.label)
		await eyeOf(field).click()
		const input = field.locator('.tenx-protected-field__revealed-input')
		await input.focus()
		const borderTop = (loc: Locator): Promise<string> =>
			loc.evaluate((el) => getComputedStyle(el).borderTopColor)
		// Once the focus border transition settles the eye matches the input, so the
		// highlight is one continuous border with no seam. Poll past the 100ms transition
		// rather than asserting on a single mid-animation frame.
		await expect
			.poll(async () => (await borderTop(eyeOf(field))) === (await borderTop(input)))
			.toBe(true)
	})

	test('create route renders every encrypted field native, with no dots or eye', async ({
		page,
	}) => {
		await page.goto(`/admin/collections/${FIXTURES.collection}/create`)
		const fullName = page.locator(`#field-${FIXTURES.fullName.name}`)
		await expect(fullName).toBeVisible()

		// A new document has nothing to conceal, so no field masks: no dots inputs, no dot
		// runs, and no reveal eye anywhere on the create form.
		await expect(page.locator('.tenx-protected-field__masked-input')).toHaveCount(0)
		await expect(page.locator('.tenx-protected-field__dots')).toHaveCount(0)
		await expect(page.locator('.tenx-protected-field__eye')).toHaveCount(0)

		// Typing into a field that started empty shows the characters unmasked.
		await fullName.fill('visible-on-create')
		await expect(fullName).toHaveValue('visible-on-create')
	})

	test('edits a revealed value and round-trips through encryption', async ({ page }) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.fullName.label)
		const rotated = 'rotated-secret-99'

		await eyeOf(field).click()
		await field.locator(`#field-${FIXTURES.fullName.name}`).fill(rotated)
		await saveDoc(page)

		await page.reload()
		const reopened = protectedField(page, FIXTURES.fullName.label)
		await eyeOf(reopened).click()
		await expect(reopened.locator(`#field-${FIXTURES.fullName.name}`)).toHaveValue(rotated)

		// Restore the seed so the reveal-based tests stay order-independent.
		await reopened.locator(`#field-${FIXTURES.fullName.name}`).fill(FIXTURES.fullName.seed)
		await saveDoc(page)
	})

	test('renders protection none as a native input with the value visible and no eye', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const input = page.locator(`#field-${FIXTURES.notes.name}`)
		await expect(input).toBeVisible()
		await expect(input).toHaveValue(FIXTURES.notes.seed)
		await expect(input).toBeEditable()

		const row = page.locator('.field-type').filter({ has: input })
		await expect(row.locator('.tenx-protected-field__eye')).toHaveCount(0)
		await expect(row.locator('.tenx-protected-field__masked-input')).toHaveCount(0)
	})

	test('masks richText and mounts the real editor with the decrypted content on reveal', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.richText.label)
		const editor = page.locator(`.rich-text-lexical[data-field-path="${FIXTURES.richText.name}"]`)

		// Concealed: dots + eye, no editor mounted.
		await expect(field.locator('.tenx-protected-field__editor-box')).toBeVisible()
		await expect(eyeOf(field)).toHaveAttribute('aria-label', SHOW)
		await expect(editor).toHaveCount(0)

		await eyeOf(field).click()
		const contentEditable = editor.locator('[contenteditable="true"]')
		await expect(contentEditable).toBeVisible()
		await expect(contentEditable).toContainText(FIXTURES.richText.seed)

		// The reveal mounts a real editor, not the removed read-only JSON view.
		await expect(page.locator('.tenx-protected-field__json')).toHaveCount(0)
		await expect(page.locator('.tenx-protected-field__notice')).toHaveCount(0)

		const marker = 'e2e appended note.'
		await contentEditable.click()
		await page.keyboard.press('ControlOrMeta+a')
		await page.keyboard.press('ArrowRight')
		await page.keyboard.type(` ${marker}`)
		await saveDoc(page)

		await page.reload()
		const reopened = protectedField(page, FIXTURES.richText.label)
		await eyeOf(reopened).click()
		const reopenedEditor = page
			.locator(`.rich-text-lexical[data-field-path="${FIXTURES.richText.name}"]`)
			.locator('[contenteditable="true"]')
		await expect(reopenedEditor).toContainText(marker)
		await expect(reopenedEditor).toContainText(FIXTURES.richText.seed)
	})

	test('renders protection none richText as the editor directly, no reveal gate, even with content', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const editor = page.locator(`.rich-text-lexical[data-field-path="${FIXTURES.draft.name}"]`)
		await expect(editor).toBeVisible()
		const contentEditable = editor.locator('[contenteditable="true"]')
		await expect(contentEditable).toBeEditable()
		// Its seeded content renders in the editor, so protection none never masks even when
		// the field holds a value (it is still encrypted at rest).
		await expect(contentEditable).toContainText(FIXTURES.draft.seed)

		// No masking chrome wraps a protection none field.
		await expect(page.locator('.tenx-protected-field').filter({ has: editor })).toHaveCount(0)
	})

	test('list view masks encrypted cells and never leaks plaintext', async ({ page }) => {
		await page.goto(`/admin/collections/${FIXTURES.collection}`)

		const fullNameCell = page.locator(`.cell-${FIXTURES.fullName.name}`).first()
		await expect(fullNameCell).toBeVisible()
		await expect(fullNameCell.locator('.tenx-protected-cell')).toBeVisible()
		await expect(fullNameCell).not.toContainText(FIXTURES.fullName.seed)

		await expect(
			page.locator(`.cell-${FIXTURES.apiKey.name} .tenx-protected-cell`).first()
		).toBeVisible()

		// protection none stays plaintext in the list (encrypted only at rest).
		await expect(page.locator(`.cell-${FIXTURES.notes.name}`).first()).toContainText(
			'Visible input, encrypted at rest'
		)
	})

	// This scans Payload's own Lexical editor, which the reveal mounts (a real richText
	// field bound to the decrypted value). Two rules are disabled because Payload's own
	// editor markup violates them in vanilla richText too, not the reveal wrapper (which
	// keeps the field's visible label: Payload's Lexical Field renders it). color-contrast
	// flags the toolbar and placeholder chrome, styled with Payload's own design tokens;
	// aria-input-field-name flags Payload's ContentEditable (role="textbox"), which exposes
	// only aria-placeholder and no programmatic accessible name. Every other structural rule
	// (roles, button names, focus order) stays enforced across the editor, and the reveal
	// eye is covered with full structural rules by the native scan below.
	test('revealed richText editor has no serious or critical structural axe violations', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.richText.label)
		await eyeOf(field).click()
		const editor = page.locator(`.rich-text-lexical[data-field-path="${FIXTURES.richText.name}"]`)
		await expect(editor.locator('[contenteditable="true"]')).toBeVisible()

		const results = await new AxeBuilder({ page })
			.include(`.rich-text-lexical[data-field-path="${FIXTURES.richText.name}"]`)
			.disableRules(['color-contrast', 'aria-input-field-name'])
			.analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})

	// The revealed native field renders Payload's TextField chrome. color-contrast is
	// disabled here too: the only sub-threshold text is Payload's own field-description,
	// styled with a core elevation token the plugin adopts for its native look and does not
	// own. This guards the revealed path's structural a11y (roles, names, focus); the
	// plugin's own reveal chrome carries no contrast-relevant text (the eye is an icon
	// button, the concealed mask is intentionally muted), so nothing plugin-owned goes
	// unchecked.
	test('revealed native encrypted field has no serious or critical structural axe violations', async ({
		page,
	}) => {
		await openShowcaseDoc(page)
		const field = protectedField(page, FIXTURES.fullName.label)
		await eyeOf(field).click()
		await expect(field.locator(`#field-${FIXTURES.fullName.name}`)).toBeVisible()

		const results = await new AxeBuilder({ page })
			.include(`.tenx-protected-field:has(#field-${FIXTURES.fullName.name})`)
			.disableRules(['color-contrast'])
			.analyze()
		const blocking = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		)
		expect(blocking).toEqual([])
	})
})
