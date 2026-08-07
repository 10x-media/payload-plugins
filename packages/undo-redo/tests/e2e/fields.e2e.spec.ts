import { expect, test } from '@playwright/test'

import {
	arrayRows,
	blockRows,
	codeEditorText,
	createDoc,
	dragRow,
	entryValue,
	field,
	fillCodeEditor,
	login,
	openDocWithHistory,
	openTab,
	readDoc,
	redo,
	richText,
	rowAction,
	saveButton,
	saveDoc,
	undo,
	waitForEntries,
} from './helpers'

/**
 * Undo and redo across the field types and container shapes the plugin has to
 * survive. The structural cases matter more than the scalar ones: the history
 * keys everything by form path, and paths are where arrays, blocks, groups and
 * tabs disagree with each other.
 */
test.describe('field coverage', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('steps back and forward through three fields in order', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Three fields', views: 1 })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'title').fill('changed title')
		await waitForEntries(page, 2)
		await field(page, 'views').fill('42')
		await waitForEntries(page, 3)
		await field(page, 'published').check()
		await waitForEntries(page, 4)

		await undo(page)
		await expect(field(page, 'published')).not.toBeChecked()
		await expect(field(page, 'views')).toHaveValue('42')

		await undo(page)
		await expect(field(page, 'views')).toHaveValue('1')
		await expect(field(page, 'title')).toHaveValue('changed title')

		await undo(page)
		await expect(field(page, 'title')).toHaveValue('Three fields')

		await redo(page, 3)
		await expect(field(page, 'title')).toHaveValue('changed title')
		await expect(field(page, 'views')).toHaveValue('42')
		await expect(field(page, 'published')).toBeChecked()
	})

	test('coalesces a typed sentence into one entry', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: '' })
		await openDocWithHistory(page, 'posts', id)

		// Typed character by character, well inside the capture debounce. One
		// keystroke per entry would make undo useless for writing.
		await field(page, 'title').pressSequentially('a whole sentence', { delay: 10 })
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'title')).toHaveValue('')
	})

	test('reverts a select and a hasMany select', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Selects', status: 'draft' })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'status').locator('.rs__control').click()
		await page.locator('.rs__option', { hasText: 'review' }).first().click()
		await expect(field(page, 'status')).toContainText('review')
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'status')).toContainText('draft')
	})

	test('restores an added array row', async ({ page }) => {
		const id = await createDoc(page, 'posts', {
			title: 'Rows',
			seo: { keywords: [{ word: 'undo' }, { word: 'redo' }] },
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'SEO')

		const rows = arrayRows(page, 'seo.keywords')
		await expect(rows).toHaveCount(2)

		await field(page, 'seo.keywords').locator('.array-field__add-row').click()
		await expect(rows).toHaveCount(3)
		await waitForEntries(page, 2)

		await undo(page)
		await expect(rows).toHaveCount(2)
		await redo(page)
		await expect(rows).toHaveCount(3)
	})

	test('restores a removed array row with its subfield values', async ({ page }) => {
		const id = await createDoc(page, 'posts', {
			title: 'Rows',
			seo: { keywords: [{ word: 'undo' }, { word: 'redo' }, { word: 'history' }] },
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'SEO')

		const rows = arrayRows(page, 'seo.keywords')
		await expect(rows).toHaveCount(3)

		// Removing loses the row's values as well as the row, so restoring it is
		// the case a value-only diff gets wrong: the row comes back empty.
		await rowAction(rows, 1, 'remove')
		await expect(rows).toHaveCount(2)
		await waitForEntries(page, 2)

		await undo(page)
		await expect(rows).toHaveCount(3)
		await expect(field(page, 'seo.keywords.1.word')).toHaveValue('redo')
	})

	test('restores array row order after a move', async ({ page }) => {
		const id = await createDoc(page, 'posts', {
			title: 'Order',
			seo: { keywords: [{ word: 'first' }, { word: 'second' }, { word: 'third' }] },
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'SEO')

		const rows = arrayRows(page, 'seo.keywords')
		await rowAction(rows, 1, 'move-up')
		await expect(field(page, 'seo.keywords.0.word')).toHaveValue('second')
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'seo.keywords.0.word')).toHaveValue('first')
		await expect(field(page, 'seo.keywords.1.word')).toHaveValue('second')
	})

	test('restores row order after a drag reorder', async ({ page }) => {
		const id = await createDoc(page, 'posts', {
			title: 'Drag',
			seo: { keywords: [{ word: 'a' }, { word: 'b' }, { word: 'c' }, { word: 'd' }] },
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'SEO')

		const rows = arrayRows(page, 'seo.keywords')
		await expect(rows).toHaveCount(4)

		// Dragging rather than using the row menu: it is how editors actually
		// reorder, and it reaches Payload's move through dnd-kit instead of a
		// direct click handler.
		await dragRow(rows, 0, 2)
		await expect(field(page, 'seo.keywords.2.word')).toHaveValue('a')
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'seo.keywords.0.word')).toHaveValue('a')
		await expect(field(page, 'seo.keywords.1.word')).toHaveValue('b')
		await redo(page)
		await expect(field(page, 'seo.keywords.2.word')).toHaveValue('a')
	})

	test('restores a removed block row including the array nested inside it', async ({ page }) => {
		const id = await createDoc(page, 'posts', {
			title: 'Blocks',
			layout: [
				{ blockType: 'hero', heading: 'Hero one', cta: { label: 'Go', url: '/go' } },
				{ blockType: 'cards', intro: 'Cards intro', cards: [{ title: 'A' }, { title: 'B' }] },
			],
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Blocks')

		const rows = blockRows(page, 'layout')
		await expect(rows).toHaveCount(2)

		await rowAction(rows, 1, 'remove')
		await expect(rows).toHaveCount(1)
		await waitForEntries(page, 2)

		await undo(page)
		await expect(rows).toHaveCount(2)
		await expect(field(page, 'layout.1.intro')).toHaveValue('Cards intro')
		// Blocks with nested arrays are where snapshot diffing usually breaks:
		// the row comes back but the rows inside it do not.
		await expect(field(page, 'layout.1.cards.0.title')).toHaveValue('A')
		await expect(field(page, 'layout.1.cards.1.title')).toHaveValue('B')
	})

	test('restores a block added through the drawer', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Add block', layout: [] })
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Blocks')

		await field(page, 'layout').locator('.blocks-field__drawer-toggler').click()
		await page.locator('.blocks-drawer__block', { hasText: 'Hero' }).first().click()
		await expect(blockRows(page, 'layout')).toHaveCount(1)
		await waitForEntries(page, 2)

		await undo(page)
		await expect(blockRows(page, 'layout')).toHaveCount(0)
		await redo(page)
		await expect(blockRows(page, 'layout')).toHaveCount(1)
	})

	test('reverts only the edited path across groups, arrays and tabs', async ({ page }) => {
		const id = await createDoc(page, 'nesting', {
			label: 'Paths',
			looseAlpha: 'root level',
			named: { alpha: 'one deep', deep: { value: 'two deep' } },
			list: [{ title: 'Row one', nested: [{ value: 'inner one' }] }],
		})
		await openDocWithHistory(page, 'nesting', id)

		await field(page, 'named.deep.value').fill('changed deep')
		await waitForEntries(page, 2)
		await field(page, 'list.0.nested.0.value').fill('changed inner')
		await waitForEntries(page, 3)

		await undo(page)
		await expect(field(page, 'list.0.nested.0.value')).toHaveValue('inner one')
		// The unnamed group contributes no path segment, so `looseAlpha` sits at
		// the document root next to unrelated fields and is easy to clobber.
		await expect(field(page, 'looseAlpha')).toHaveValue('root level')
		await expect(field(page, 'named.deep.value')).toHaveValue('changed deep')

		await undo(page)
		await expect(field(page, 'named.deep.value')).toHaveValue('two deep')
		await expect(field(page, 'named.alpha')).toHaveValue('one deep')
	})

	test('repaints the rich text editor on undo and on redo', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Lexical' })
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Rich text')

		const editor = richText(page, 'content')
		await editor.click()
		await page.keyboard.type('written in lexical')
		await waitForEntries(page, 2)

		await undo(page)
		await expect(editor).not.toContainText('written in lexical')

		// Redo used to restore the form value without the editor noticing, so the
		// text only reappeared after a save. Lexical re-reads the form when the
		// initialValue identity changes, and nothing else.
		await redo(page)
		await expect(editor).toContainText('written in lexical')
	})

	test('leaves a field opted out through admin.custom untouched', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Opt out' })
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Rich text')

		const notes = richText(page, 'notes')
		await notes.click()
		await page.keyboard.type('private note')

		// Only the second edit is captured, so the count is the assertion: an
		// entry for the note would leave three here instead of two.
		await field(page, 'plainNextToRich').fill('tracked')
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'plainNextToRich')).toHaveValue('')
		// Ignored paths are passed through from the live state on restore, so undo
		// must neither revert the note nor drop it.
		await expect(notes).toContainText('private note')
	})

	/**
	 * `admin.condition` is stripped from the client config, so a field's
	 * visibility is not something the browser can work out on its own: Payload
	 * evaluates conditions on the server and ships the answer as
	 * `passesCondition` in form state. That makes visibility part of what undo
	 * restores, and it is restored from the snapshot rather than recomputed.
	 */
	test('restores a field hidden by a condition, with its value and its subtree', async ({
		page,
	}) => {
		const id = await createDoc(page, 'posts', {
			title: 'Conditions',
			hasPromo: true,
			promoCode: 'SUMMER',
			promoDetails: { note: 'a note', tiers: [{ label: 'gold' }] },
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Conditions')
		await expect(field(page, 'promoCode')).toHaveValue('SUMMER')

		await field(page, 'hasPromo').uncheck()
		await expect(field(page, 'promoCode')).toBeHidden()
		await expect(field(page, 'promoDetails.note')).toBeHidden()
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'promoCode')).toHaveValue('SUMMER')
		// A failing condition stops the walk into the container, so everything
		// under it has to come back together with it.
		await expect(field(page, 'promoDetails.note')).toHaveValue('a note')
		await expect(arrayRows(page, 'promoDetails.tiers')).toHaveCount(1)

		await redo(page)
		await expect(field(page, 'promoCode')).toBeHidden()
	})

	test('hides again on undo a field that a condition had revealed', async ({ page }) => {
		const id = await createDoc(page, 'posts', {
			title: 'Conditions off',
			hasPromo: false,
			promoCode: 'SUMMER',
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Conditions')
		await expect(field(page, 'promoCode')).toBeHidden()

		// The field was never in form state on load, so the server adds it when the
		// condition starts passing. Undo has to drop a path it never captured.
		await field(page, 'hasPromo').check()
		await expect(field(page, 'promoCode')).toHaveValue('SUMMER')
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'promoCode')).toBeHidden()
		await expect(field(page, 'hasPromo')).not.toBeChecked()

		await redo(page)
		await expect(field(page, 'promoCode')).toHaveValue('SUMMER')
	})

	test('restores a per-row condition driven by sibling data', async ({ page }) => {
		const id = await createDoc(page, 'posts', {
			title: 'Row conditions',
			conditionalRows: [{ mode: 'detailed', detail: 'row detail' }, { mode: 'simple' }],
		})
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Conditions')
		await expect(field(page, 'conditionalRows.0.detail')).toHaveValue('row detail')
		await expect(field(page, 'conditionalRows.1.detail')).toBeHidden()

		await field(page, 'conditionalRows.0.mode').locator('.rs__control').click()
		await page.locator('.rs__option', { hasText: 'simple' }).first().click()
		await expect(field(page, 'conditionalRows.0.detail')).toBeHidden()
		await waitForEntries(page, 2)

		// Sibling-scoped conditions resolve per row, so undoing one row must not
		// reveal the other.
		await undo(page)
		await expect(field(page, 'conditionalRows.0.detail')).toHaveValue('row detail')
		await expect(field(page, 'conditionalRows.1.detail')).toBeHidden()
	})

	test('undoes a localized array without touching the other locale', async ({ page }) => {
		// The default locale is `en`, so the create lands there and the patch adds
		// the German values the undo must not reach.
		const id = await createDoc(page, 'localized-docs', {
			title: 'English',
			localizedItems: [{ label: 'English row' }],
		})
		const res = await page.request.patch(`/api/localized-docs/${id}?locale=de`, {
			data: { title: 'Deutsch', localizedItems: [{ label: 'Deutsche Zeile' }] },
		})
		expect(res.ok()).toBeTruthy()

		await page.goto(`/admin/collections/localized-docs/${id}?locale=en`)
		await expect(field(page, 'title')).toHaveValue('English')
		await waitForEntries(page, 1)

		await field(page, 'localizedItems.0.label').fill('edited in english')
		await waitForEntries(page, 2)
		await undo(page)
		await expect(field(page, 'localizedItems.0.label')).toHaveValue('English row')

		const de = await readDoc(page, `localized-docs/${id}?locale=de&depth=0`)
		expect(de.title).toBe('Deutsch')
		expect((de.localizedItems as { label: string }[])[0]?.label).toBe('Deutsche Zeile')
	})

	/**
	 * Payload's JSON field keeps the raw editor text in form state while it does
	 * not parse, and renders the editor from JSON.stringify(value), so restoring
	 * that text would show it double-encoded. The history carries the last value
	 * it can restore instead of recording one it cannot.
	 */
	test('keeps a JSON field out of the history while its text does not parse', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'JSON', metadata: { test: '123' } })
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Scalars')

		await fillCodeEditor(page, 'metadata', '{"test": }')
		await field(page, 'title').fill('typed after breaking the json')
		await waitForEntries(page, 2)
		expect(await entryValue(page, 'metadata')).toEqual({ test: '123' })

		await undo(page)
		await expect(field(page, 'title')).toHaveValue('JSON')
		await expect.poll(() => codeEditorText(page, 'metadata')).toContain('"test": "123"')

		await redo(page)
		await expect(field(page, 'title')).toHaveValue('typed after breaking the json')
		await expect.poll(() => codeEditorText(page, 'metadata')).toContain('"test": "123"')
		// A restored raw string would arrive escaped inside quotes instead, so the
		// absence of a backslash is the assertion that matters here.
		expect(await codeEditorText(page, 'metadata')).not.toContain('\\')
	})

	/**
	 * A polymorphic relationship hands react-select's option objects straight to
	 * form state, so its value carries a label and permission flags that move on
	 * their own. The save is the visible case: the server merge replaces the
	 * options with bare references, which used to be captured as an edit and
	 * appended an entry identical to the one before it.
	 */
	test('captures no entry when a save strips a polymorphic relationship down', async ({ page }) => {
		await createDoc(page, 'tags', { name: 'alpha' })
		const id = await createDoc(page, 'posts', { title: 'Polymorphic' })
		await openDocWithHistory(page, 'posts', id)
		await openTab(page, 'Relations')

		await field(page, 'mixed').locator('.rs__control').click()
		await page.locator('.rs__option', { hasText: 'alpha' }).first().click()
		await waitForEntries(page, 2)

		await saveDoc(page, 'posts')
		await expect(saveButton(page)).toBeDisabled()
		// The merge arrives after the save response and the capture that used to
		// turn it into a duplicate entry is debounced behind that, so asserting
		// the absence of an entry means outlasting both rather than sampling once.
		await page.waitForTimeout(1500)
		await waitForEntries(page, 2)

		await undo(page)
		await expect(field(page, 'mixed').locator('.rs__multi-value')).toHaveCount(0)
	})
})
