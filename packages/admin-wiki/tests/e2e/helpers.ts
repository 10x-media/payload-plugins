import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared driving code for the admin-wiki e2e specs.
 *
 * Every spec creates the documents it needs through the REST API and removes
 * them again. The dev app seeds guides on boot, and several surfaces read the
 * whole collection (the orphan banner reads drafts too), so a leftover fixture
 * is not private to the spec that made it.
 */

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

export const PAGES = 'wiki-pages'

export const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', { data: ADMIN })
	expect(res.ok()).toBeTruthy()
}

export const createDoc = async (
	page: Page,
	collection: string,
	data: Record<string, unknown>
): Promise<string> => {
	const res = await page.request.post(`/api/${collection}`, { data })
	if (!res.ok()) throw new Error(`create ${collection} failed: ${await res.text()}`)
	const { doc } = (await res.json()) as { doc: { id: number | string } }
	return String(doc.id)
}

export const deleteDoc = async (page: Page, collection: string, id: string): Promise<void> => {
	await page.request.delete(`/api/${collection}/${id}`)
}

/** `apiPath` is everything after `/api/`, so a caller can ask for the draft. */
export const readDoc = async (page: Page, apiPath: string): Promise<Record<string, unknown>> => {
	const res = await page.request.get(`/api/${apiPath}`)
	if (!res.ok()) throw new Error(`read ${apiPath} failed: ${await res.text()}`)
	return (await res.json()) as Record<string, unknown>
}

/**
 * Guides are created as drafts, which keeps them off every reading surface
 * while still being the real thing the Targets tab edits. The title carries a
 * nonce because the slug hook derives a unique slug from it.
 */
export const createGuide = async (
	page: Page,
	title: string,
	targetFields: string[] = []
): Promise<string> =>
	createDoc(page, PAGES, {
		_status: 'draft',
		targetFields,
		title: `${title} ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
	})

export const storedTargets = async (page: Page, id: string): Promise<string[]> => {
	const doc = await readDoc(page, `${PAGES}/${id}?draft=true`)
	return (doc.targetFields as string[] | undefined) ?? []
}

export const saveButton = (page: Page): Locator => page.locator('#action-save')

/** Guides use drafts, so saving one as a draft keeps a fixture off the surfaces. */
export const saveDraft = async (page: Page, collection: string): Promise<void> => {
	const saved = page.waitForResponse(
		(res) => res.url().includes(`/api/${collection}`) && res.request().method() === 'PATCH'
	)
	await page.locator('#action-save-draft').click()
	expect((await saved).ok()).toBeTruthy()
}

export const openTab = async (page: Page, label: string): Promise<void> => {
	await page.locator('.tabs-field__tab-button', { hasText: label }).first().click()
}

export const openGuideTargets = async (page: Page, id: string): Promise<void> => {
	await page.goto(`/admin/collections/${PAGES}/${id}`)
	await expect(saveButton(page)).toBeVisible()
	await openTab(page, 'Targets')
	await expect(targetList(page)).toBeVisible()
}

export const targetList = (page: Page): Locator => page.locator('#field-targetFields')

export const groups = (page: Page): Locator => page.locator('.wiki-target-fields__group')

/** One section of the list, addressed by the owner label its header carries. */
export const group = (page: Page, label: string): Locator =>
	groups(page).filter({
		has: page.locator('.wiki-target-fields__group-header', { hasText: label }),
	})

export const pathsOfGroup = (scope: Locator): Locator => scope.locator('.wiki-target-fields__path')

/**
 * The breadcrumb trail one row shows. Read as text content rather than as
 * innerText: the separators are CSS generated content, which Chromium folds
 * into innerText and would append to the crumb before it.
 */
export const crumbsOf = async (row: Locator): Promise<string[]> =>
	row.locator('.wiki-target-fields__crumb').allTextContents()

/**
 * The open popup's contents. Every popup on the page stays mounted in a portal
 * so its own modals survive closing, and the document controls carry one too,
 * so only the class Payload puts on an active popup separates them.
 */
export const openPopup = (page: Page): Locator => page.locator('.popup__content')

/**
 * Open the picker for one kind. With three kinds covered the button is a menu,
 * which is what the dev app exercises; the single-kind shortcut is a plain
 * button and needs no second click.
 */
export const pickFields = async (page: Page, kind: string): Promise<void> => {
	await page.locator('.wiki-target-fields__open').click()
	await openPopup(page).locator('.popup-button-list__button', { hasText: kind }).click()
}

export const picker = (page: Page): Locator => page.locator('.wiki-field-picker')

/** Wait for the picker's form state to arrive, which is what mounts the plates. */
export const pickerReady = async (page: Page): Promise<void> => {
	await expect(picker(page).locator('.wiki-field-pick').first()).toBeVisible({ timeout: 30_000 })
}

const fieldId = (path: string): string => `#field-${path.replace(/\./g, '__')}`

/**
 * The row holding one field's control and, after it, the description slot the
 * plugin renders into. Payload puts the field id on the control itself, so the
 * slot is a sibling of it rather than a descendant, and the nearest wrap above
 * the control is the one element that holds both.
 */
const wrapOf = (control: Locator): Locator =>
	control.locator('xpath=ancestor::div[contains(@class, "field-type__wrap")][1]')

export const fieldWrap = (page: Page, path: string): Locator => wrapOf(page.locator(fieldId(path)))

/** The select plate on one field, addressed by its path inside the picked form. */
export const plate = (page: Page, path: string): Locator =>
	wrapOf(picker(page).locator(fieldId(path))).locator('.wiki-field-pick')

/**
 * Click one field's select plate.
 *
 * Payload mounts each group of fields only once its container nears the
 * viewport, so a field far enough down the form is not in the DOM at all and no
 * locator can wait for it to appear. The drawer is scrolled a pane at a time
 * until the plate exists, which is what an author does to reach it; once
 * mounted, a field stays mounted.
 */
export const pickField = async (page: Page, path: string): Promise<void> => {
	const target = plate(page, path)
	const pane = page.locator('.wiki-field-picker-modal .drawer__content-children')
	await expect
		.poll(
			async () => {
				if ((await target.count()) > 0) {
					return true
				}
				await pane.evaluate((element) => element.scrollBy(0, element.clientHeight * 0.8))
				return false
			},
			{ timeout: 20_000 }
		)
		.toBe(true)
	await target.click()
}

export const pickerSelect = (page: Page): Locator =>
	picker(page).locator('.wiki-field-picker__source')

export const chooseEntity = async (page: Page, label: string): Promise<void> => {
	await pickerSelect(page).locator('.rs__control').click()
	await page.locator('.rs__option', { hasText: label }).click()
}

/** The nested block grid, which the block picker opens on its own when empty. */
export const chooseBlock = async (page: Page, label: string): Promise<void> => {
	await page.locator('.blocks-drawer__block', { hasText: label }).click()
}

export const applyPicker = async (page: Page): Promise<void> => {
	await picker(page).getByRole('button', { name: 'Apply' }).click()
	await expect(picker(page)).toBeHidden()
}

export const cancelPicker = async (page: Page): Promise<void> => {
	await picker(page).getByRole('button', { name: 'Cancel' }).click()
	await expect(picker(page)).toBeHidden()
}

export const addPathByHand = async (page: Page, path: string): Promise<void> => {
	await targetList(page).locator('.wiki-target-fields__manual-input input').fill(path)
	await targetList(page).getByRole('button', { name: 'Add' }).click()
}
