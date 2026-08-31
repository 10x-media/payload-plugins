import { expect, type Page, test } from '@playwright/test'

import { findJobID, login } from './helpers'

const JSON_EDITOR = '#field-input .monaco-editor'

type MonacoModel = { getValue: () => string; setValue: (v: string) => void }
type MonacoWindow = Window & {
	monaco?: {
		Uri: { parse: (uri: string) => unknown }
		editor: { getModel: (uri: unknown) => MonacoModel | null }
	}
}

/**
 * The Monaco model behind the `input` JSON editor, found through the editor's
 * `data-uri`. Runs in the page, so the lookup is inlined into each evaluate.
 */
const editorText = (page: Page): Promise<string> =>
	page.evaluate((selector) => {
		const { monaco } = window as MonacoWindow
		const uri = document.querySelector(selector)?.getAttribute('data-uri')
		const model = monaco && uri ? monaco.editor.getModel(monaco.Uri.parse(uri)) : null
		return model?.getValue() ?? ''
	}, JSON_EDITOR)

/** Replace the JSON editor's text through Monaco, the way typing would. */
const setEditorText = (page: Page, text: string): Promise<void> =>
	page.evaluate(
		([selector, next]) => {
			const { monaco } = window as MonacoWindow
			const uri = document.querySelector(selector)?.getAttribute('data-uri')
			const model = monaco && uri ? monaco.editor.getModel(monaco.Uri.parse(uri)) : null
			model?.setValue(next)
		},
		[JSON_EDITOR, text] as const
	)

const pick = async (page: Page, field: 'taskSlug' | 'workflowSlug', slug: string) => {
	await page.click(`#field-${field} [class*="control"]`)
	await page.getByText(slug, { exact: true }).last().click()
}
const pickTask = (page: Page, slug: string) => pick(page, 'taskSlug', slug)

const openCreate = async (page: Page): Promise<void> => {
	await login(page)
	await page.goto('/admin/collections/payload-jobs/create')
	await expect(page.locator(JSON_EDITOR)).toBeVisible()
}

test('a task with a schema opens on its placeholder, one without opens on {}', async ({ page }) => {
	await openCreate(page)
	await pick(page, 'workflowSlug', 'runAutomation')
	await expect.poll(() => editorText(page)).toContain('"automation": ""')
	await page.click('#field-workflowSlug [class*="clear-indicator"]')
	await pickTask(page, 'noop')
	await expect.poll(() => editorText(page)).toBe('{}')
})

test('an example fills the JSON editor and a custom editor replaces it', async ({ page }) => {
	await openCreate(page)
	await pickTask(page, 'sendDigest')
	await expect.poll(() => editorText(page)).toContain('"subject": "Weekly digest"')
	await pickTask(page, 'sleep')
	await expect(page.locator('input[name="input.ms"]')).toHaveValue('1500')
	await expect(page.locator(JSON_EDITOR)).toHaveCount(0)
})

test('each slug keeps its own draft, and a slug without a schema never shows another one', async ({
	page,
}) => {
	await openCreate(page)
	await pickTask(page, 'sendDigest')
	await expect.poll(() => editorText(page)).toContain('Weekly digest')
	await setEditorText(page, '{"subject":"EDITED"}')
	await pickTask(page, 'inline')
	await expect.poll(() => editorText(page)).toBe('{}')
	await pickTask(page, 'importAthletes')
	await page.locator('input[name="input.limit"]').fill('42')
	await pickTask(page, 'sendDigest')
	await expect.poll(() => editorText(page)).toContain('"subject": "EDITED"')
	await pickTask(page, 'importAthletes')
	await expect(page.locator('input[name="input.limit"]')).toHaveValue('42')
})

test('clearing the selection resets the field, and an invalid draft is not restored', async ({
	page,
}) => {
	await openCreate(page)
	await pickTask(page, 'sendDigest')
	await expect.poll(() => editorText(page)).toContain('Weekly digest')
	await setEditorText(page, '{"subject": oops')
	await pickTask(page, 'noop')
	await pickTask(page, 'sendDigest')
	await expect.poll(() => editorText(page)).toContain('"subject": "Weekly digest"')
	await page.click('#field-taskSlug [class*="clear-indicator"]')
	await expect.poll(() => editorText(page)).toBe('{}')
})

test('an existing job shows its stored input read-only', async ({ page }) => {
	await login(page)
	const id = await findJobID(page, 'where[taskSlug][equals]=sleep')
	await page.goto(`/admin/collections/payload-jobs/${id}`)
	const ms = page.locator('input[name="input.ms"]')
	await expect(ms).toHaveValue('1500')
	await expect(ms).toBeDisabled()
})
