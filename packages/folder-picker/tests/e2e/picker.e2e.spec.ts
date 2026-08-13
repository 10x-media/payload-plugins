import { expect, type Locator, type Page, test } from '@playwright/test'

const FIXTURES = {
	collection: 'posts',
	docTitle: 'Picker showcase',
	// The second folder-enabled collection, so these prove a switch actually changed what is listed.
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
	teamFile: 'team-anna',
	teamFolder: 'Team',
}

/** Payload's own markup. Copied here so a rename upstream fails loudly in one place. */
const SELECTORS = {
	card: '.folder-file-card',
	crumb: '.collection-folder-list__trail-crumb',
	drawer: '.list-drawer',
	folderBrowser: '.collection-folder-list',
	lexicalEditor: '.ContentEditable__root',
	// The slash-menu entry carries an explicit role="option", so it is not reachable by button
	// role; its id is stable and derived from the feature key.
	lexicalUploadItem: '#slash-menu-popup__item-upload',
	listToggler: '.upload__listToggler',
	// A relationship with `appearance: 'drawer'` opens the drawer from the select's onMenuOpen,
	// so its control is the trigger; there is no separate button to click.
	relationshipControl: '.rs__control',
	selectCollection: '.list-drawer__select-collection-wrap',
	// The dark pill in the search bar row, which is what makes confirming the obvious action.
	confirm: '.search-bar .pill--style-dark',
	tab: '.default-list-view-tabs__button',
	table: '.table',
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

const byFolderTab = (drawer: Locator): Locator =>
	drawer.locator(SELECTORS.tab).filter({ hasText: 'By folder' })

/**
 * A card selects on one click and opens on a second within 400ms. Two spaced clicks rather than
 * `dblclick()`: Payload compares the clicked item against state written by the first click, and
 * a zero-delay double click lands before React has committed it, so nothing opens.
 */
const activateCard = async (page: Page, drawer: Locator, name: string): Promise<void> => {
	const card = drawer.locator(SELECTORS.card).filter({ hasText: name }).first()
	await card.click()
	await page.waitForTimeout(120)
	await card.click()
}

/** Opens a folder and waits for the breadcrumb to prove the browser actually moved. */
const openFolder = async (page: Page, drawer: Locator, name: string): Promise<void> => {
	await activateCard(page, drawer, name)
	await expect(drawer.locator(SELECTORS.crumb).filter({ hasText: name })).toBeVisible()
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

type FolderDoc = { folder?: { name?: string } | null; id: string }

const folderByName = async (page: Page, name: string): Promise<FolderDoc> => {
	const res = await page.request.get(
		`/api/payload-folders?where[name][equals]=${encodeURIComponent(name)}&depth=1&limit=1`
	)
	const { docs } = (await res.json()) as { docs: FolderDoc[] }
	const doc = docs[0]
	if (!doc) throw new Error(`no folder named ${name}`)
	return doc
}

/** Puts a folder back at the root, so a drag test can run twice and still start from the seed. */
const detachFolder = async (page: Page, name: string): Promise<void> => {
	const folder = await folderByName(page, name)
	const res = await page.request.patch(`/api/payload-folders/${folder.id}`, {
		data: { folder: null },
	})
	expect(res.ok()).toBeTruthy()
}

/**
 * dnd-kit activates on pointer movement, so a single jump (what `dragTo` does) never starts a drag.
 * The intermediate moves are the point rather than the distance: the crash this guards against was
 * thrown on the first one, before any drop could happen.
 */
const dragOnto = async (page: Page, from: Locator, to: Locator): Promise<void> => {
	const start = await from.boundingBox()
	const end = await to.boundingBox()
	if (!start || !end) throw new Error('both cards have to be on screen to drag between them')

	const fromX = start.x + start.width / 2
	const fromY = start.y + start.height / 2
	const toX = end.x + end.width / 2
	const toY = end.y + end.height / 2

	await page.mouse.move(fromX, fromY)
	await page.mouse.down()
	for (let step = 1; step <= 10; step += 1) {
		await page.mouse.move(fromX + ((toX - fromX) * step) / 10, fromY + ((toY - fromY) * step) / 10)
		await page.waitForTimeout(30)
	}
	await page.mouse.up()
}

const pickCollection = async (page: Page, drawer: Locator, label: string): Promise<void> => {
	await drawer.locator(`${SELECTORS.selectCollection} ${SELECTORS.relationshipControl}`).click()
	await page.locator('.rs__option').filter({ hasText: label }).first().click()
}

const activeTab = (drawer: Locator): Locator => drawer.locator(`${SELECTORS.tab}--active`)

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
		await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadSingle')

		await expect(drawer.locator(SELECTORS.tab).filter({ hasText: 'All' })).toBeVisible()
		await expect(byFolderTab(drawer)).toBeVisible()

		// The swapped view defers to DefaultListView outside a drawer, so the route is untouched.
		await page.goto('/admin/collections/media')
		await expect(page.locator(SELECTORS.table)).toBeVisible()
		await expect(page.locator(SELECTORS.folderBrowser)).toHaveCount(0)
	})

	test('navigates into a subfolder and selecting a file sets the field', async ({ page }) => {
		const id = await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadSingle')

		await byFolderTab(drawer).click()
		await expect(drawer.locator(SELECTORS.folderBrowser)).toBeVisible()

		await openFolder(page, drawer, FIXTURES.parentFolder)
		await openFolder(page, drawer, FIXTURES.nestedFolder)

		// Picking a document goes through the same activation as opening a folder.
		await activateCard(page, drawer, FIXTURES.nestedFile)
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		expect(await fieldValue(page, id, 'uploadSingle')).toBeTruthy()
	})

	test('selects several files across folders for a hasMany field', async ({ page }) => {
		const id = await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadMany')

		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.rootFolder)
		await activateCard(page, drawer, FIXTURES.rootFile)
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		// Selection lives in the folder provider and resets when the folder changes, so a second
		// file from a different branch is a second trip through the drawer.
		const second = await openUploadDrawer(page, 'uploadMany')
		await byFolderTab(second).click()
		await openFolder(page, second, FIXTURES.parentFolder)
		await openFolder(page, second, FIXTURES.teamFolder)
		await activateCard(page, second, FIXTURES.teamFile)
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		const value = await fieldValue(page, id, 'uploadMany')
		expect(Array.isArray(value) ? value.length : 0).toBeGreaterThan(1)
	})

	test('hides a file the field already holds, so it cannot be stored twice', async ({ page }) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadMany')

		const drawer = await openUploadDrawer(page, 'uploadMany')
		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.rootFolder)
		await activateCard(page, drawer, FIXTURES.rootFile)
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		// Payload's list tab drops what the field already holds through `filterOptions`, and the
		// upload field appends whatever it is handed, so a folder that still offered the file
		// would let it be stored a second time.
		const again = await openUploadDrawer(page, 'uploadMany')
		await byFolderTab(again).click()
		await openFolder(page, again, FIXTURES.rootFolder)
		await expect(again.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFile })).toHaveCount(
			0
		)

		// Everything else in the same folder is still there and still pickable.
		await activateCard(page, again, FIXTURES.rootFileSecond)
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		const value = await fieldValue(page, id, 'uploadMany')
		expect(Array.isArray(value) ? value.length : 0).toBe(2)
	})

	test('offers the same held file again once it is removed from the field', async ({ page }) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadMany')

		const drawer = await openUploadDrawer(page, 'uploadMany')
		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.rootFolder)
		await drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFile }).first().click()
		await drawer.locator(SELECTORS.confirm).click()
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)
		await save(page)

		// Emptying the field puts the file back among the options, so the rule follows the value
		// rather than being a one-way hide.
		await clearField(page, id, 'uploadMany')
		const again = await openUploadDrawer(page, 'uploadMany')
		await byFolderTab(again).click()
		await openFolder(page, again, FIXTURES.rootFolder)
		await expect(again.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFile })).toBeVisible()
	})

	test('picks a file with one click and the selection bar, without a double click', async ({
		page,
	}) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadSingle')
		const drawer = await openUploadDrawer(page, 'uploadSingle')

		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.rootFolder)

		// Nothing is offered until something is selected, and one click is enough to offer it.
		await expect(drawer.locator(SELECTORS.confirm)).toHaveCount(0)
		await drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFile }).first().click()
		await expect(drawer.locator(SELECTORS.confirm)).toBeVisible()

		await drawer.locator(SELECTORS.confirm).click()
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		expect(await fieldValue(page, id, 'uploadSingle')).toBeTruthy()
	})

	test('a single upload field never selects more than one file', async ({ page }) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadSingle')
		const drawer = await openUploadDrawer(page, 'uploadSingle')

		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.rootFolder)

		await drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFile }).first().click()
		// Ctrl builds a multi-selection on a `hasMany` field. A single-value field cannot take
		// one, so the modifier has to be inert rather than promising files it will drop.
		await drawer
			.locator(SELECTORS.card)
			.filter({ hasText: FIXTURES.rootFileSecond })
			.first()
			.click({ modifiers: ['ControlOrMeta'] })

		// The pill counts what it is about to hand over, and only shows a number above one.
		await expect(drawer.locator(SELECTORS.confirm)).not.toHaveText(/\d/)

		await drawer.locator(SELECTORS.confirm).click()
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		const value = await fieldValue(page, id, 'uploadSingle')
		expect(Array.isArray(value)).toBe(false)
		expect(value).toBeTruthy()
	})

	test('confirms several files at once for a hasMany field', async ({ page }) => {
		const id = await openShowcase(page)
		await clearField(page, id, 'uploadMany')
		const drawer = await openUploadDrawer(page, 'uploadMany')

		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.rootFolder)

		await drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFile }).first().click()
		// A plain click replaces the selection, so a second file is added the way a file manager does.
		await drawer
			.locator(SELECTORS.card)
			.filter({ hasText: FIXTURES.rootFileSecond })
			.first()
			.click({ modifiers: ['ControlOrMeta'] })

		await expect(drawer.locator(SELECTORS.confirm)).toHaveText(/2/)
		await drawer.locator(SELECTORS.confirm).click()
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		const value = await fieldValue(page, id, 'uploadMany')
		expect(Array.isArray(value) ? value.length : 0).toBe(2)
	})

	test('switches collections from the folder tab of a polymorphic field', async ({ page }) => {
		await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadPolymorphic')

		// The drawer's own list tab carries the select, so the folder tab has to as well.
		await expect(drawer.locator(SELECTORS.selectCollection)).toBeVisible()
		await byFolderTab(drawer).click()
		await expect(drawer.locator(SELECTORS.folderBrowser)).toBeVisible()
		await expect(drawer.locator(SELECTORS.selectCollection)).toBeVisible()

		await pickCollection(page, drawer, 'File')

		// Switching re-renders the view in place rather than remounting it, so the folders shown have
		// to belong to the collection that was picked.
		await expect(drawer.locator('.list-header__title')).toHaveText('Files')
		await expect(
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.filesFolder })
		).toBeVisible()
		await expect(
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.parentFolder })
		).toHaveCount(0)
	})

	test('stays on the folder tab and returns to the root when the collection changes', async ({
		page,
	}) => {
		await openShowcase(page)
		const drawer = await openUploadDrawer(page, 'uploadPolymorphic')

		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.parentFolder)
		await pickCollection(page, drawer, 'File')

		// The view is re-rendered for the new collection, which must not drop the caller back on the
		// list tab, and must not leave a trail into a folder the new collection has no part in.
		await expect(activeTab(drawer)).toHaveText(/folder/i)
		await expect(drawer.locator(SELECTORS.folderBrowser)).toBeVisible()
		await expect(drawer.locator(SELECTORS.table)).toHaveCount(0)
		await expect(
			drawer.locator(SELECTORS.crumb).filter({ hasText: FIXTURES.parentFolder })
		).toHaveCount(0)
		await expect(
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.filesFolder })
		).toBeVisible()

		// And back, since the second switch runs against state the first one left behind.
		await pickCollection(page, drawer, 'Media')
		await expect(activeTab(drawer)).toHaveText(/folder/i)
		await expect(
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.parentFolder })
		).toBeVisible()
		await expect(
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.filesFolder })
		).toHaveCount(0)
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
		await byFolderTab(drawer).click()
		await openFolder(page, drawer, FIXTURES.filesFolder)

		await drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.filesFile }).first().click()
		await drawer.locator(SELECTORS.confirm).click()
		await expect(page.locator(SELECTORS.drawer)).toHaveCount(0)

		await save(page)
		// A polymorphic field stores what it was told to store, so the wrong slug here would be a
		// silent mismatch rather than a visible one.
		expect(await fieldValue(page, id, 'uploadPolymorphic')).toMatchObject({ relationTo: 'files' })
	})

	test('drags a folder into another one without crashing the drawer', async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))

		// The seed puts both folders at the root; a previous run of this test may not have.
		await detachFolder(page, FIXTURES.rootFolder)

		const id = await openShowcase(page)
		await clearField(page, id, 'uploadSingle')
		const drawer = await openUploadDrawer(page, 'uploadSingle')
		await byFolderTab(drawer).click()
		await expect(drawer.locator(SELECTORS.folderBrowser)).toBeVisible()

		await dragOnto(
			page,
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFolder }).first(),
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.parentFolder }).first()
		)

		// The crash was thrown on the first pointer move, so this fails even if the drop is ignored.
		expect(errors).toEqual([])
		await expect(
			drawer.locator(SELECTORS.card).filter({ hasText: FIXTURES.rootFolder })
		).toHaveCount(0)
		expect((await folderByName(page, FIXTURES.rootFolder)).folder?.name).toBe(FIXTURES.parentFolder)

		await detachFolder(page, FIXTURES.rootFolder)
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
