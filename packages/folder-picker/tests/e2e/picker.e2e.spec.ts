import { expect, type Locator, type Page, test } from '@playwright/test'

const FIXTURES = {
	collection: 'posts',
	docTitle: 'Picker showcase',
	// The second foldered collection, so these prove a switch actually changed what is listed.
	filesFile: 'spec-sheet',
	filesFolder: 'Documents',
	// Payload appends a counter on filename collisions, and the dev seed can run more than once
	// per boot, so match on the stable prefix rather than the exact stored filename.
	nestedFile: 'hero-desktop',
	nestedFolder: 'Hero images',
	parentFolder: 'Marketing',
	rootFile: 'brand-logo',
	rootFileSecond: 'brand-mark',
	rootFolder: 'Brand',
}

/** Payload's own markup. Copied here so a rename upstream fails loudly in one place. */
const SELECTORS = {
	confirm: '.folder-picker__confirm',
	drawer: '.list-drawer',
	folderBrowser: '.folder-picker',
	lexicalEditor: '.ContentEditable__root',
	// The slash-menu entry carries an explicit role="option", so it is not reachable by button
	// role; its id is stable and derived from the feature key.
	lexicalUploadItem: '#slash-menu-popup__item-upload',
	listToggler: '.upload__listToggler',
	nameLink: '.hierarchy-tables__name-link',
	// A relationship with `appearance: 'drawer'` opens the drawer from the select's onMenuOpen,
	// so its control is the trigger; there is no separate button to click.
	relationshipControl: '.rs__control',
	row: '.hierarchy-tables tr[data-id]',
	section: '.table-section',
	selectCollection: '.list-drawer__select-collection-wrap',
	table: '.table',
	trail: '.folder-picker__trail',
}

const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: 'dev@10xmedia.de', password: 'password' },
	})
	expect(res.ok()).toBeTruthy()
}

const openShowcase = async (page: Page): Promise<string> => {
	const res = await page.request.get(
		`/api/${FIXTURES.collection}?where[title][equals]=${encodeURIComponent(FIXTURES.docTitle)}&limit=1`
	)
	const { docs } = (await res.json()) as { docs: { id: string }[] }
	const doc = docs[0]
	if (!doc) throw new Error(`no ${FIXTURES.collection} doc titled ${FIXTURES.docTitle}`)
	await page.goto(`/admin/collections/${FIXTURES.collection}/${doc.id}`)
	await expect(page.locator('#field-uploadSingle')).toBeVisible()
	return doc.id
}

const openUploadDrawer = async (page: Page, field: string): Promise<Locator> => {
	await page.locator(`#field-${field} ${SELECTORS.listToggler}`).click()
	const drawer = page.locator(SELECTORS.drawer).last()
	await expect(drawer).toBeVisible()
	return drawer
}

/**
 * The bar's tabs, by id: the hosted hierarchy view renders its own "By Folder" pill too (hidden,
 * since it pushes the collection route), and a closed drawer can stay mounted with the same ids.
 */
const byFolderTab = (drawer: Locator): Locator => drawer.locator('#folder-picker-tab-folders')
const listTab = (drawer: Locator): Locator => drawer.locator('#folder-picker-tab-list')

/**
 * Switches to the folder tab and starts at the root. The drawer keeps its tab and folder across a
 * close and reopen, so a second trip opens where the first one left off. The browser only mounts
 * once its data is in, so the trail is settled by the time it is visible. At the root the trail is
 * the root crumb alone, with no link back.
 */
const showFolders = async (drawer: Locator): Promise<void> => {
	const tab = byFolderTab(drawer)
	if (!(await tab.isDisabled())) {
		await tab.click()
	}
	await expect(drawer.locator(SELECTORS.folderBrowser)).toBeVisible()
	const up = drawer.locator(`${SELECTORS.trail} button`)
	if ((await up.count()) > 0) {
		await up.first().click()
		await expect(up).toHaveCount(0)
	}
}

/** A row of the folder tab, folder or document, by the start of its title. */
const row = (drawer: Locator, name: string): Locator =>
	drawer.locator(SELECTORS.row).filter({ hasText: name }).first()

/** Opens a folder and waits for the trail to prove the browser actually moved. */
const openFolder = async (drawer: Locator, name: string): Promise<void> => {
	await row(drawer, name).locator(SELECTORS.nameLink).click()
	await expect(drawer.locator(`${SELECTORS.trail} [aria-current="page"]`)).toHaveText(name)
}

/** A single field picks the way the route view opens a document: a click on its name. */
const pick = async (drawer: Locator, name: string): Promise<void> => {
	await row(drawer, name).locator(SELECTORS.nameLink).click()
}

const tick = async (drawer: Locator, name: string): Promise<void> => {
	await row(drawer, name).locator('input[type="checkbox"]').check()
}

const fieldValue = async (page: Page, id: string, field: string): Promise<unknown> => {
	const res = await page.request.get(`/api/${FIXTURES.collection}/${id}?depth=0`)
	const doc = (await res.json()) as Record<string, unknown>
	return doc[field]
}

/**
 * Every test drives the same showcase document, so one that asserts on an exact value empties the
 * field first rather than depending on what ran before it. A filled single upload also hides the
 * toggler this file opens the drawer with.
 */
const clearField = async (page: Page, id: string, field: string): Promise<void> => {
	const res = await page.request.patch(`/api/${FIXTURES.collection}/${id}`, {
		data: { [field]: null },
	})
	expect(res.ok()).toBeTruthy()
	await page.reload()
	await expect(page.locator(`#field-${field}`)).toBeVisible()
}

const pickCollection = async (page: Page, drawer: Locator, label: string): Promise<void> => {
	await drawer.locator(`${SELECTORS.selectCollection} ${SELECTORS.relationshipControl}`).click()
	await page.locator('.rs__option').filter({ hasText: label }).first().click()
}

const save = async (page: Page): Promise<void> => {
	const saved = page.waitForResponse(
		(r) => r.url().includes(`/api/${FIXTURES.collection}`) && r.request().method() === 'PATCH'
	)
	await page.locator('#action-save').click()
	expect((await saved).ok()).toBeTruthy()
}

test.describe('folder picker', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('adds folder tabs to the upload drawer and leaves the list route alone', async ({
		page,
	}) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadSingle')
		const drawer = await openUploadDrawer(page, 'uploadSingle')

		await expect(listTab(drawer)).toBeVisible()
		await expect(byFolderTab(drawer)).toBeVisible()

		// The swapped view defers to DefaultListView outside a drawer, so the route is untouched.
		await page.goto('/admin/collections/media')
		await expect(page.locator(SELECTORS.table)).toBeVisible()
		await expect(page.locator(SELECTORS.folderBrowser)).toHaveCount(0)
	})

	test('navigates into a subfolder and back up the trail', async ({ page }) => {
		await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadMany')
		await showFolders(drawer)

		await openFolder(drawer, FIXTURES.parentFolder)
		await openFolder(drawer, FIXTURES.nestedFolder)
		await expect(row(drawer, FIXTURES.nestedFile)).toBeVisible()

		await drawer
			.locator(`${SELECTORS.trail} button`)
			.filter({ hasText: FIXTURES.parentFolder })
			.click()
		await expect(drawer.locator(`${SELECTORS.trail} [aria-current="page"]`)).toHaveText(
			FIXTURES.parentFolder
		)
		await expect(row(drawer, FIXTURES.nestedFolder)).toBeVisible()
	})

	test('picks a file with a click on its name for a single field', async ({ page }) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadSingle')
		const drawer = await openUploadDrawer(page, 'uploadSingle')
		await showFolders(drawer)

		// A single field has no confirm: its value is one click away, as on the list tab.
		await expect(drawer.locator(SELECTORS.confirm)).toHaveCount(0)
		await openFolder(drawer, FIXTURES.parentFolder)
		await openFolder(drawer, FIXTURES.nestedFolder)
		await pick(drawer, FIXTURES.nestedFile)
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		const value = await fieldValue(page, id, 'uploadSingle')
		expect(Array.isArray(value)).toBe(false)
		expect(value).toBeTruthy()
	})

	test('confirms several ticked files at once for a hasMany field', async ({ page }) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadMany')
		const drawer = await openUploadDrawer(page, 'uploadMany')
		await showFolders(drawer)
		await openFolder(drawer, FIXTURES.rootFolder)

		const confirm = drawer.locator(SELECTORS.confirm)
		await expect(confirm).toBeDisabled()
		await tick(drawer, FIXTURES.rootFile)
		await tick(drawer, FIXTURES.rootFileSecond)
		await expect(confirm).toBeEnabled()

		await confirm.click()
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		const value = await fieldValue(page, id, 'uploadMany')
		expect(Array.isArray(value) ? value.length : 0).toBe(2)
	})

	test('hides a file the field already holds, and offers it again once removed', async ({
		page,
	}) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadMany')

		const drawer = await openUploadDrawer(page, 'uploadMany')
		await showFolders(drawer)
		await openFolder(drawer, FIXTURES.rootFolder)
		await tick(drawer, FIXTURES.rootFile)
		await drawer.locator(SELECTORS.confirm).click()
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		// Payload's list tab drops what the field already holds through `filterOptions`, and the
		// upload field appends whatever it is handed, so a folder that still offered the file
		// would let it be stored a second time.
		const again = await openUploadDrawer(page, 'uploadMany')
		await showFolders(again)
		// The document now has unsaved changes, so this click is also the one Payload's
		// leave-without-saving guard would take for a navigation away from it.
		await openFolder(again, FIXTURES.rootFolder)
		await expect(row(again, FIXTURES.rootFileSecond)).toBeVisible()
		await expect(again.locator(SELECTORS.row).filter({ hasText: FIXTURES.rootFile })).toHaveCount(0)
		await page.keyboard.press('Escape')
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		await clearField(page, id, 'uploadMany')
		const cleared = await openUploadDrawer(page, 'uploadMany')
		await showFolders(cleared)
		await openFolder(cleared, FIXTURES.rootFolder)
		await expect(row(cleared, FIXTURES.rootFile)).toBeVisible()
	})

	test('lists only folders that accept the collection, and follows a collection switch', async ({
		page,
	}) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadPolymorphic')
		const drawer = await openUploadDrawer(page, 'uploadPolymorphic')

		// The drawer's own list tab carries the select, so the folder tab has to as well.
		await expect(drawer.locator(SELECTORS.selectCollection)).toBeVisible()
		await showFolders(drawer)
		await expect(drawer.locator(SELECTORS.selectCollection)).toBeVisible()
		await expect(row(drawer, FIXTURES.parentFolder)).toBeVisible()
		await expect(
			drawer.locator(SELECTORS.row).filter({ hasText: FIXTURES.filesFolder })
		).toHaveCount(0)

		await openFolder(drawer, FIXTURES.parentFolder)
		await pickCollection(page, drawer, 'File')

		// The switch remounts the drawer's view, which must not drop the caller back on the list
		// tab, and must not leave a trail into a folder the new collection has no part in.
		await expect(byFolderTab(drawer)).toHaveClass(/--active/)
		await expect(drawer.locator(`${SELECTORS.trail} button`)).toHaveCount(0)
		await expect(row(drawer, FIXTURES.filesFolder)).toBeVisible()
		await expect(
			drawer.locator(SELECTORS.row).filter({ hasText: FIXTURES.parentFolder })
		).toHaveCount(0)

		// And back, since the second switch runs against state the first one left behind.
		await pickCollection(page, drawer, 'Media')
		await expect(byFolderTab(drawer)).toHaveClass(/--active/)
		await expect(row(drawer, FIXTURES.parentFolder)).toBeVisible()
	})

	test('carries the switched collection into the folder tab and into the saved value', async ({
		page,
	}) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadPolymorphic')
		const drawer = await openUploadDrawer(page, 'uploadPolymorphic')

		// Switching from the list tab first: the folder tab has to open on the collection that was
		// chosen there rather than on the field's first one.
		await pickCollection(page, drawer, 'File')
		await expect(drawer.locator(SELECTORS.table)).toBeVisible()
		await showFolders(drawer)
		await openFolder(drawer, FIXTURES.filesFolder)

		await pick(drawer, FIXTURES.filesFile)
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		// A polymorphic field stores what it was told to store, so the wrong slug here would be a
		// silent mismatch rather than a visible one.
		expect(await fieldValue(page, id, 'uploadPolymorphic')).toMatchObject({ relationTo: 'files' })
	})

	test('opens the same picker from a lexical upload node', async ({ page }) => {
		await openShowcase(page)

		const editor = page.locator(SELECTORS.lexicalEditor).first()
		await editor.click()
		await editor.pressSequentially('/upload')
		await page.locator(SELECTORS.lexicalUploadItem).click()

		const drawer = page.locator(SELECTORS.drawer).last()
		await expect(drawer).toBeVisible()
		await expect(byFolderTab(drawer)).toBeVisible()
	})

	test('opens the same picker from a relationship drawer', async ({ page }) => {
		await openShowcase(page)
		await page.locator(`#field-relationshipSingle ${SELECTORS.relationshipControl}`).click()

		const drawer = page.locator(SELECTORS.drawer).last()
		await expect(drawer).toBeVisible()
		await expect(byFolderTab(drawer)).toBeVisible()
	})

	test('leaves the drawer stock for a collection without folders', async ({ page }) => {
		await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadWithoutFolders')

		await expect(byFolderTab(drawer)).toHaveCount(0)
		await expect(drawer.locator(SELECTORS.folderBrowser)).toHaveCount(0)
		await expect(drawer.locator(SELECTORS.table)).toBeVisible()
	})

	test('leaves a collection that declares its own list view alone', async ({ page }) => {
		await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadCurated')

		await expect(drawer.locator('[data-testid="curated-list-view"]')).toHaveCount(1)
		await expect(byFolderTab(drawer)).toHaveCount(0)
	})
})
