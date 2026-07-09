import { expect, type Page, test } from '@playwright/test'

test('admin panel loads with jobs plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('payload health endpoint responds', async ({ request }) => {
	const response = await request.get('/admin')
	expect(response.status()).toBeLessThan(500)
})

const login = async (page: Page): Promise<void> => {
	await page.goto('/admin/login')
	await page.fill('input[name="email"]', 'dev@10xmedia.de')
	await page.fill('input[name="password"]', 'password')
	await page.click('button[type="submit"]')
	await page.waitForURL((url) => !url.pathname.includes('/login'))
}

// Doc URLs end in the document id (hex on mongo, numeric on postgres); exclude /create.
const DOC_URL = /\/collections\/payload-jobs\/(?!create($|\?))[\w%-]+/

test('health-bar failed badge filters the jobs list', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/payload-jobs')

	// Health-bar pills read "<count> <status>"; status cells render the bare label
	// and are not links, so this cannot match table content.
	const failedPill = page.getByRole('link', { name: /^\d+\+? Failed$/ })
	await expect(failedPill).toBeVisible()
	await failedPill.click()

	await page.waitForURL(/where/)
	// The seed has exactly one failed job (hasError without error.cancelled) and the
	// e2e app runs no worker, so derived statuses cannot drift during the test.
	await expect(page.locator('table tbody tr')).toHaveCount(1)
	await expect(page.locator('td.cell-jobTitle a').first()).toHaveText('Run automation')
})

test('total chip clears applied filters', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/payload-jobs')

	await page.getByRole('link', { name: /^\d+\+? Failed$/ }).click()
	await page.waitForURL(/where/)
	await expect(page.locator('table tbody tr')).toHaveCount(1)

	// The total chip is a button (JobsTotalChip) that clears search + filters in
	// place via refineListData; the seed creates exactly 7 jobs.
	await page.getByRole('button', { name: /^\d+\+? jobs$/ }).click()
	await expect(page.locator('table tbody tr')).toHaveCount(7)
})

test('job title column links to the document', async ({ page }) => {
	await login(page)
	await page.goto('/admin/collections/payload-jobs')

	const titleLink = page.locator('td.cell-jobTitle a').first()
	await expect(titleLink).toHaveText('Run automation')
	await titleLink.click()

	await page.waitForURL(DOC_URL)
	expect(page.url()).toMatch(DOC_URL)
})
