import { expect, type Page, test } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

/** The seeded media document whose `alt` is the fixture's name (filenames may carry a `-N` suffix). */
const mediaId = async (page: Page, alt: string): Promise<string> => {
	const response = await page.request.get(
		`/api/media?depth=0&limit=1&where[alt][equals]=${encodeURIComponent(alt)}`
	)
	const { docs } = (await response.json()) as { docs: Array<{ id: number | string }> }
	const doc = docs[0]
	if (!doc) {
		throw new Error(`No seeded media "${alt}"`)
	}
	return String(doc.id)
}

const openMedia = async (page: Page, alt: string) => {
	await page.goto(`/admin/collections/media/${await mediaId(page, alt)}`)
	return page.locator('.file-preview')
}

test.beforeEach(async ({ page }) => {
	const response = await page.request.post('/api/users/login', { data: ADMIN })
	expect(response.ok()).toBe(true)
})

test('the file panel renders Markdown with the plugin viewer', async ({ page }) => {
	const panel = await openMedia(page, 'notes.md')
	const preview = panel.locator('.document-preview-panel')
	await expect(preview.locator('.document-preview-markdown__article h1')).toHaveText(
		'Release notes'
	)
	await expect(panel.locator('.file-preview__info-meta')).toContainText('text/markdown')
})

test('the file panel renders CSV as a table', async ({ page }) => {
	const panel = await openMedia(page, 'tiny.csv')
	const preview = panel.locator('.document-preview-panel')
	await expect(preview.locator('.document-preview-csv__row--header')).toBeVisible()
	await expect(preview.locator('.document-preview-toolbar__value')).toContainText('rows')
})

test('images stay with Payload’s own preview', async ({ page }) => {
	const panel = await openMedia(page, 'sample.png')
	await expect(panel.locator('.file-preview__image-wrap .thumbnail img')).toBeVisible()
	await expect(panel.locator('.document-preview-panel')).toHaveCount(0)
})

test('an unsupported file keeps Payload’s thumbnail, drawn as the file-type icon', async ({
	page,
}) => {
	const panel = await openMedia(page, 'archive.zip')
	await expect(panel.locator('.document-preview-panel')).toHaveCount(0)
	await expect(panel.locator('.thumbnail img')).toHaveAttribute(
		'src',
		/\/api\/document-preview\/file-icon\//
	)
})

test('the list column opens the file in a drawer', async ({ page }) => {
	await page.goto('/admin/collections/media?limit=100')
	const row = page.locator('tbody tr', { hasText: 'notes' }).filter({ hasText: 'text/markdown' })
	await expect(row.locator('.cell-filesize')).toHaveText('757 bytes')
	await row.getByRole('button', { name: /notes.*\.md/ }).click()
	const drawer = page.locator('.document-preview-drawer:visible')
	await expect(drawer.locator('.document-preview-markdown__article h1')).toHaveText('Release notes')
})
