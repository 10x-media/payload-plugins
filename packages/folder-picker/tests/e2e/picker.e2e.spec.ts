import { expect, type Locator, type Page, test } from '@playwright/test'

const FIXTURES = {
	collection: 'posts',
	docTitle: 'Picker showcase',
	// Payload appends a counter on filename collisions, and the dev seed can run more than once
	// per boot, so match on the stable prefix rather than the exact stored filename.
	nestedFile: 'hero-desktop',
	nestedFolder: 'Hero images',
	parentFolder: 'Marketing',
	rootFile: 'brand-logo',
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
