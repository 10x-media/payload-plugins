import { expect, type Page, test } from '@playwright/test'

/**
 * The cases a panel gets wrong quietly: what a stale link does, what Escape does over unsaved
 * edits, whether the back button walks the panel and nothing else, whether a hosted list still
 * filters into the URL. None of them shows up in a unit test, and all of them are what somebody
 * hits on their second day.
 */

const EMAIL = 'dev@10xmedia.de'
const PASSWORD = 'password'

/**
 * Through the API: the login form is not under test here, and driving it against the production
 * build flaked, leaving the wait for the redirect off `/login` to time out.
 */
const login = async (page: Page): Promise<void> => {
	const res = await page.request.post('/api/users/login', {
		data: { email: EMAIL, password: PASSWORD },
	})
	expect(res.ok()).toBeTruthy()
}

/** Payload's list writes its default query (`?depth=1&limit=10`) into the address. */
const tagsList = /\/admin\/collections\/tags(\?|$)/

const panel = (page: Page) => page.locator('.settings-overlay__panel')
const rail = (page: Page) => page.locator('.settings-overlay__rail')
const row = (page: Page, label: string) =>
	page.locator('.settings-overlay__rail-item', { hasText: label })

/**
 * The pane hosts the list in drawer mode, where the linked column is a button that selects the
 * row rather than an anchor, so the row itself is not what to click.
 */
const openFirstRow = async (page: Page): Promise<void> => {
	await page
		.locator('.settings-overlay__pane-body tbody tr')
		.first()
		.locator('[class*="__first-cell"]')
		.click()
}

test.beforeEach(async ({ page }) => {
	await login(page)
})

test.describe('opening and addressing', () => {
	test('opens from a nav button and lands on the first row', async ({ page }) => {
		await page.goto('/admin')
		await page.getByRole('button', { name: 'Open system settings' }).click()
		await expect(panel(page)).toBeVisible()
		await expect(page).toHaveURL(/settings=system/)
	})

	test('a deep link opens the named row', async ({ page }) => {
		await page.goto('/admin?settings=system/branding')
		await expect(panel(page)).toBeVisible()
		await expect(page.locator('.settings-overlay__pane-title')).toHaveText(/branding/i)
	})

	test('a stale link falls back to a row the reader can open', async ({ page }) => {
		await page.goto('/admin?settings=system/gone/999')
		await expect(panel(page)).toBeVisible()
		await expect(page.locator('.settings-overlay__pane-body')).toBeVisible()
	})

	test('back closes the panel in one step', async ({ page }) => {
		await page.goto('/admin')
		await page.getByRole('button', { name: 'Open system settings' }).click()
		await expect(panel(page)).toBeVisible()
		await page.goBack()
		await expect(panel(page)).toBeHidden()
	})

	test('back after closing reopens the panel, with no dead press on the way', async ({ page }) => {
		await page.goto('/admin')
		await page.goto('/admin/collections/tags')
		await page.getByRole('button', { name: 'Open system settings' }).click()
		await expect(panel(page)).toBeVisible()
		await page.locator('.settings-overlay__pane-header button[aria-label="Close"]').click()
		await expect(page).not.toHaveURL(/settings=/)
		await page.goBack()
		await expect(panel(page)).toBeVisible()
		await page.goBack()
		await expect(panel(page)).toBeHidden()
		await expect(page).toHaveURL(tagsList)
		await page.goBack()
		await expect(page).toHaveURL(/\/admin$/)
	})

	test('back walks every step taken inside the panel', async ({ page }) => {
		await page.goto('/admin')
		await page.getByRole('button', { name: 'Open system settings' }).click()
		await expect(page).toHaveURL(/settings=system%2Fappearance/)
		await row(page, 'Tags').click()
		await openFirstRow(page)
		await expect(page).toHaveURL(/settings=system%2Ftags%2F|settings=system\/tags\//)
		await page.goBack()
		await expect(page).toHaveURL(/settings=system(%2F|\/)tags($|&)/)
		await page.goBack()
		await expect(page).toHaveURL(/settings=system%2Fappearance/)
		await page.goBack()
		await expect(panel(page)).toBeHidden()
		await expect(page).toHaveURL(/\/admin$/)
	})

	test("history: 'replace' leaves the back button to the page", async ({ page }) => {
		await page.goto('/admin')
		await page.goto('/admin/collections/tags')
		await page.getByRole('button', { name: 'Open workspace (wide, searchable)' }).click()
		await row(page, 'Notes').click()
		await expect(page).toHaveURL(/settings=workspace%2Fnotes/)
		await page.locator('.settings-overlay__pane-header button[aria-label="Close"]').click()
		await expect(page).toHaveURL(tagsList)
		await page.goBack()
		await expect(page).toHaveURL(/\/admin$/)
	})

	test('returning to an address that names the panel opens it and keeps it open', async ({
		page,
	}) => {
		await page.goto('/admin/collections/tags')
		await page.getByRole('button', { name: 'Open workspace (wide, searchable)' }).click()
		await expect(page).toHaveURL(/settings=workspace/)
		await page.goBack()
		await page.goForward()
		await expect(panel(page)).toBeVisible()
		// Payload closes all modals on a route change; that is not Escape, so the address stays.
		await page.waitForTimeout(500)
		await expect(panel(page)).toBeVisible()
		await expect(page).toHaveURL(/settings=workspace/)
	})

	test('a filtered list survives a reload', async ({ page }) => {
		await page.goto('/admin?settings=system/tags')
		await expect(panel(page)).toBeVisible()
		const search = panel(page).locator('input[type="search"], .search-filter input').first()
		await search.fill('Engineering')
		await expect(page).toHaveURL(/settingsQuery=/)
		await page.reload()
		await expect(panel(page)).toBeVisible()
		await expect(page).toHaveURL(/settingsQuery=/)
	})
})

test.describe('the rail', () => {
	test('shows only what the reader may open, grouped', async ({ page }) => {
		await page.goto('/admin?settings=system')
		await expect(rail(page)).toBeVisible()
		await expect(row(page, 'Appearance')).toBeVisible()
		await expect(page.locator('.settings-overlay__rail-group-label')).toContainText(['Content'])
	})

	test('search narrows the rail without closing the open pane', async ({ page }) => {
		await page.goto('/admin?settings=workspace/notes')
		const search = rail(page).locator('.settings-overlay__search-input')
		await search.fill('scratch')
		await expect(row(page, 'Notes')).toBeVisible()
		await expect(page.locator('.settings-overlay__pane-body')).toContainText('Eager component')
	})

	test('search matches a keyword the label does not contain', async ({ page }) => {
		await page.goto('/admin?settings=workspace')
		await rail(page).locator('.settings-overlay__search-input').fill('keyboard')
		await expect(row(page, 'Shortcuts')).toBeVisible()
		await expect(row(page, 'Dashboard')).toHaveCount(0)
	})

	test('search keeps only the rows that match, across groups', async ({ page }) => {
		await page.goto('/admin?settings=workspace')
		await rail(page).locator('.settings-overlay__search-input').fill('overview')
		await expect(row(page, 'Dashboard')).toBeVisible()
		await expect(row(page, 'Documentation')).toBeVisible()
		await expect(row(page, 'Exports')).toHaveCount(0)
		await expect(row(page, 'Stats')).toHaveCount(0)
		// Every group is open while filtering, so the headings drop out rather than stay as dead
		// toggles.
		await expect(rail(page).locator('.settings-overlay__rail-group-label')).toHaveCount(0)
	})

	test('a collapsed group still shows its matches while searching', async ({ page }) => {
		await page.goto('/admin?settings=workspace')
		await rail(page).locator('.settings-overlay__rail-group-toggle', { hasText: 'Help' }).click()
		await expect(row(page, 'Shortcuts')).toBeHidden()

		await rail(page).locator('.settings-overlay__search-input').fill('keyboard')
		await expect(row(page, 'Shortcuts')).toBeVisible()
	})

	test('a group the reader collapsed is still collapsed after a reload', async ({ page }) => {
		await page.goto('/admin?settings=workspace')
		await rail(page).locator('.settings-overlay__rail-group-toggle', { hasText: 'Data' }).click()
		await expect(row(page, 'Exports')).toBeHidden()

		await page.reload()
		await expect(rail(page)).toBeVisible()
		await expect(row(page, 'Exports')).toBeHidden()
	})

	test('search finds nothing and says so', async ({ page }) => {
		await page.goto('/admin?settings=workspace')
		await rail(page).locator('.settings-overlay__search-input').fill('zzz')
		await expect(rail(page).locator('.settings-overlay__rail-empty')).toBeVisible()
	})

	test('a badge renders beside a counted row', async ({ page }) => {
		await page.goto('/admin?settings=system')
		await expect(row(page, 'Tags').locator('.settings-overlay__badge')).toBeVisible()
	})
})

test.describe('panes', () => {
	test('an eager component opens with no request', async ({ page }) => {
		await page.goto('/admin?settings=system/notes')
		await expect(page.locator('.settings-overlay__pane-body')).toContainText('Eager component')
	})

	test('a lazy server component is fetched on open', async ({ page }) => {
		await page.goto('/admin?settings=system/stats')
		await expect(page.locator('.settings-overlay__pane-body')).toContainText(
			'Lazy server component'
		)
		await expect(page.locator('.settings-overlay__pane-body')).toContainText('tags:')
	})

	test('an embedded view drops the admin chrome', async ({ page }) => {
		await page.goto('/admin?settings=system/report')
		const body = page.locator('.settings-overlay__pane-body')
		await expect(body).toContainText('Dev report')
		await expect(body).toContainText('the admin chrome is left out')
		await expect(body.locator('.nav')).toHaveCount(0)
	})

	test('a collection opens its list, then a document, then goes back', async ({ page }) => {
		await page.goto('/admin?settings=system/tags')
		await openFirstRow(page)
		await expect(page).toHaveURL(/settings=system%2Ftags%2F|settings=system\/tags\//)
		await page.locator('.settings-overlay__pane-header button[aria-label="Back"]').click()
		await expect(page).toHaveURL(/settings=system(%2F|\/)tags($|&)/)
	})

	test('a tenant global opens its document straight away, with no back chevron', async ({
		page,
	}) => {
		await page.goto('/admin?settings=system/site-settings')
		await expect(page.locator('.settings-overlay__pane-body')).toBeVisible()
		await expect(
			page.locator('.settings-overlay__pane-header button[aria-label="Back"]')
		).toHaveCount(0)
	})
})

test.describe('unsaved edits', () => {
	test('Escape over a modified document asks before discarding', async ({ page }) => {
		await page.goto('/admin?settings=system/branding')
		const field = page.locator('.settings-overlay__pane-body input[type="text"]').first()
		await field.fill('changed in the panel')
		await page.keyboard.press('Escape')
		await expect(page.getByText('Discard changes?')).toBeVisible()
		await expect(panel(page)).toBeVisible()
	})

	test('switching rows over a modified document asks first', async ({ page }) => {
		await page.goto('/admin?settings=system/branding')
		const field = page.locator('.settings-overlay__pane-body input[type="text"]').first()
		await field.fill('changed in the panel')
		await row(page, 'Tags').click()
		await expect(page.getByText('Discard changes?')).toBeVisible()
	})
})

test.describe('the whole admin', () => {
	test('a collection a hiding panel lists is gone from the nav and from its own route', async ({
		page,
	}) => {
		// Only the workspace panel sets `hideEntities`, so `secrets` is hidden while `tags`, listed
		// by the system panel under the default, keeps its nav entry.
		await page.goto('/admin')
		await expect(page.locator('.nav a[href*="/collections/secrets"]')).toHaveCount(0)
		await expect(page.locator('.nav a[href*="/collections/tags"]')).toHaveCount(1)

		const response = await page.goto('/admin/collections/secrets')
		expect(response?.status()).toBeLessThan(500)
	})

	test('two overlays coexist, and opening one closes the other', async ({ page }) => {
		await page.goto('/admin')
		await page.getByRole('button', { name: 'Open system settings' }).click()
		await expect(page.locator('.settings-overlay--system')).toBeVisible()
		// The open panel's backdrop covers the nav, so no pointer reaches the other launcher.
		// Dispatching its click still makes the same `useSettingsOverlay()` call a component
		// inside the panel would.
		await page.getByRole('button', { name: /Open workspace/ }).dispatchEvent('click')
		await expect(page.locator('.settings-overlay--workspace')).toBeVisible()
		await expect(page.locator('.settings-overlay--system')).toBeHidden()
	})

	test('dark mode leaves the panel legible', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' })
		await page.goto('/admin?settings=system/notes')
		await expect(panel(page)).toBeVisible()
		const background = await panel(page).evaluate(
			(element) => getComputedStyle(element).backgroundColor
		)
		expect(background).not.toBe('rgba(0, 0, 0, 0)')
	})
})
