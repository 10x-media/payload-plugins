import { expect, test } from '@playwright/test'

import {
	blurToBody,
	createDoc,
	debugButton,
	field,
	login,
	openDoc,
	openDocWithHistory,
	openGlobal,
	openTab,
	overlayEntries,
	readHistory,
	redoButton,
	richText,
	undo,
	undoButton,
	waitForEntries,
} from './helpers'

/**
 * Where the controls appear, when they are usable, and which input surfaces own
 * the keyboard instead of the plugin.
 */
test.describe('undo/redo controls', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('mounts before the document controls and starts with both actions unavailable', async ({
		page,
	}) => {
		const id = await createDoc(page, 'posts', { title: 'Controls' })
		await openDocWithHistory(page, 'posts', id)

		// The plugin mounts through `beforeDocumentControls`, so the buttons must
		// sit inside the same toolbar as save rather than float somewhere else.
		await expect(page.locator('.doc-controls__controls .undo-redo-controls')).toBeVisible()
		await expect(undoButton(page)).toBeDisabled()
		await expect(redoButton(page)).toBeDisabled()
	})

	test('enables undo after an edit and redo only after undoing', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Controls' })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'title').fill('edited')
		await waitForEntries(page, 2)
		await expect(undoButton(page)).toBeEnabled()
		await expect(redoButton(page)).toBeDisabled()

		await undo(page)
		await expect(undoButton(page)).toBeDisabled()
		await expect(redoButton(page)).toBeEnabled()
	})

	test('mounts on globals, which use a different admin slot', async ({ page }) => {
		await openGlobal(page, 'site-settings')
		await expect(undoButton(page)).toBeVisible()

		await field(page, 'siteName').fill('Global edit')
		await waitForEntries(page, 2)
		await undo(page)
		await expect(field(page, 'siteName')).toHaveValue('')
	})

	test('stays off collections that opted out', async ({ page }) => {
		const id = await createDoc(page, 'tags', { name: 'opted-out' })
		await openDoc(page, 'tags', id)

		await expect(page.locator('.undo-redo-controls')).toHaveCount(0)
		expect(await readHistory(page)).toBeNull()
	})

	test('undoes and redoes from the keyboard once focus leaves the field', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Keyboard' })
		await openDocWithHistory(page, 'posts', id)

		const title = field(page, 'title')
		await title.fill('typed with the keyboard')
		await waitForEntries(page, 2)

		await blurToBody(title)
		await page.keyboard.press('ControlOrMeta+z')
		await expect(title).toHaveValue('Keyboard')
		expect((await readHistory(page))?.index).toBe(0)

		await page.keyboard.press('ControlOrMeta+Shift+z')
		await expect(title).toHaveValue('typed with the keyboard')
		expect((await readHistory(page))?.index).toBe(1)
	})

	test('leaves the keyboard to the browser inside a text input', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Native undo' })
		await openDocWithHistory(page, 'posts', id)

		const title = field(page, 'title')
		await title.fill('typed into the input')
		await waitForEntries(page, 2)

		// The browser owns undo inside an input, and it works: the field reverts
		// without the plugin stepping the history at all.
		await title.focus()
		await page.keyboard.press('ControlOrMeta+z')
		await expect(title).toHaveValue('Native undo')
		expect((await readHistory(page))?.index).toBe(1)

		// What the browser did is an edit like any other, so it is captured as the
		// next entry rather than being confused with a history step.
		await waitForEntries(page, 3)
		expect((await readHistory(page))?.index).toBe(2)
	})

	test('leaves the keyboard to Lexical inside a rich text editor', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Lexical keyboard' })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'title').fill('changed outside the editor')
		await waitForEntries(page, 2)

		await openTab(page, 'Rich text')
		const editor = richText(page, 'content')
		await editor.click()
		await page.keyboard.type('inside lexical')
		await waitForEntries(page, 3)

		// Focus is in a contenteditable, which Lexical's own history owns. The
		// plugin must not also step back, or one keypress undoes two things.
		await page.keyboard.press('ControlOrMeta+z')
		expect((await readHistory(page))?.index).toBe(2)

		// The edit made before entering the editor is still the current state,
		// which it would not be if the plugin had also handled the keypress.
		await openTab(page, 'Scalars')
		await expect(field(page, 'title')).toHaveValue('changed outside the editor')
	})

	test('opens the debug overlay and restores the entry it is asked for', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Overlay' })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'title').fill('first')
		await waitForEntries(page, 2)
		await field(page, 'title').fill('second')
		await waitForEntries(page, 3)

		await debugButton(page).click()
		const overlay = page.locator('.undo-redo-debug')
		await expect(overlay).toBeVisible()
		await expect(overlayEntries(page)).toHaveCount(3)
		await expect(overlay.locator('.undo-redo-debug__meta')).toContainText('3/3')

		// Jumping is the overlay's reason to exist: stepping to a specific entry
		// without pressing undo repeatedly.
		await overlayEntries(page).first().locator('.undo-redo-debug__jump').click()
		await expect(field(page, 'title')).toHaveValue('Overlay')
		await expect(overlay.locator('.undo-redo-debug__meta')).toContainText('1/3')
	})
})
