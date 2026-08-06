import { expect, test } from '@playwright/test'

import {
	createDoc,
	debugButton,
	entryValue,
	field,
	login,
	openDocWithHistory,
	readHistory,
	redo,
	redoButton,
	saveButton,
	saveDoc,
	undo,
	undoButton,
	waitForEntries,
} from './helpers'

/**
 * How the stack itself behaves: what a new edit does to the redo tail, where
 * the cap bites, what counts as saved, and what survives a reload.
 */
test.describe('history behaviour', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('drops the redo tail when a new edit follows an undo', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Tail' })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'title').fill('one')
		await waitForEntries(page, 2)
		await field(page, 'title').fill('two')
		await waitForEntries(page, 3)

		await undo(page)
		await expect(redoButton(page)).toBeEnabled()

		await field(page, 'title').fill('branch')
		await waitForEntries(page, 3)
		await expect(redoButton(page)).toBeDisabled()

		await undo(page)
		await expect(field(page, 'title')).toHaveValue('one')
	})

	test('caps the stack at the configured maxHistory', async ({ page }) => {
		// `drafts` is configured with maxHistory 5 and a short capture debounce.
		const id = await createDoc(page, 'drafts', { title: 'Cap' })
		await openDocWithHistory(page, 'drafts', id)

		for (let edit = 1; edit <= 7; edit++) {
			await field(page, 'title').fill(`edit ${edit}`)
			// Waiting on the captured value, not on the index or the length: once
			// the cap starts evicting, both saturate and stop moving on new edits.
			await expect.poll(() => entryValue(page, 'title')).toBe(`edit ${edit}`)
		}

		const history = await readHistory(page)
		expect(history?.length).toBe(5)
		// The oldest entries are gone, so undo bottoms out inside the retained
		// window rather than walking back to the document as it loaded.
		await undo(page, 4)
		await expect(undoButton(page)).toBeDisabled()
		await expect(field(page, 'title')).toHaveValue('edit 3')
	})

	test('tracks the saved document as the baseline across undo and redo', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Baseline' })
		await openDocWithHistory(page, 'posts', id)
		await debugButton(page).click()
		const meta = page.locator('.undo-redo-debug__meta')

		await field(page, 'title').fill('saved value')
		await waitForEntries(page, 2)
		await saveDoc(page, 'posts')
		await expect(meta).toContainText('clean')

		// The server answers a save with a merged form state. That echo must not
		// land in the stack, or the redo tail is truncated by the save itself.
		expect((await readHistory(page))?.length).toBe(2)

		await undo(page)
		await expect(meta).toContainText('unsaved')

		// Stepping back onto the saved state is a return to clean, even though it
		// is reached by undoing rather than by saving again.
		await redo(page)
		await expect(meta).toContainText('clean')
		expect((await readHistory(page))?.length).toBe(2)
	})

	test('keeps no baseline on an autosaving collection', async ({ page }) => {
		const id = await createDoc(page, 'drafts', { title: 'Autosave' })
		await openDocWithHistory(page, 'drafts', id)
		await debugButton(page).click()

		// Autosave persists continuously, so "differs from what is persisted" is
		// not a state the editor can be in long enough to be worth reporting.
		await expect(page.locator('.undo-redo-debug__meta')).toContainText('autosave, no baseline')
		expect((await readHistory(page))?.hasBaseline).toBe(false)
	})

	test('starts over after a reload', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Reload' })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'title').fill('unsaved edit')
		await waitForEntries(page, 2)

		await page.reload()
		await waitForEntries(page, 1)
		await expect(undoButton(page)).toBeDisabled()
		await expect(redoButton(page)).toBeDisabled()
		// The history is per editor session and never reaches the server, so the
		// unsaved edit is gone with it.
		await expect(field(page, 'title')).toHaveValue('Reload')
	})

	test('leaves the document matching the form after undoing and saving again', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Desync', views: 1 })
		await openDocWithHistory(page, 'posts', id)

		await field(page, 'title').fill('first save')
		await waitForEntries(page, 2)
		await saveDoc(page, 'posts')
		await expect(saveButton(page)).toBeDisabled()

		await field(page, 'title').fill('second edit')
		await waitForEntries(page, 3)
		await expect(saveButton(page)).toBeEnabled()

		// Undoing onto the state the document was saved from leaves nothing to
		// save, and the button says so rather than offering a no-op write.
		await undo(page)
		await expect(field(page, 'title')).toHaveValue('first save')
		await expect(saveButton(page)).toBeDisabled()

		await redo(page)
		await expect(saveButton(page)).toBeEnabled()
		await saveDoc(page, 'posts')
		await page.reload()
		await expect(field(page, 'title')).toHaveValue('second edit')
	})
})
