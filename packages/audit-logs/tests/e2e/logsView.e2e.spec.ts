import { expect, test } from '@playwright/test'
import { createDoc, filterPills, gotoLogs, login, rowSummary, rows, updateDoc } from './helpers'

test.describe('signed in', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
	})

	test('the view renders the seeded entries', async ({ page }) => {
		await gotoLogs(page)

		expect(await rows(page).count()).toBeGreaterThan(0)
		await expect(page.locator('.al-view')).toBeVisible()
		await expect(page.locator('.page-controls__page-info')).toBeVisible()
	})

	test('a row expands to show its diff', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'E2E before' })
		await updateDoc(page, 'posts', id, { title: 'E2E after' })

		await gotoLogs(page, `?documentId=${id}&operation=update`)

		const row = rows(page).first()
		await expect(row.locator('.al-row__body')).not.toBeVisible()

		await rowSummary(row).click()
		await expect(row.locator('.al-diff')).toBeVisible()
		await expect(row.locator('.al-diff__path').first()).toHaveText('title')
	})

	test('a row is expandable from the keyboard', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Keyboard before' })
		await updateDoc(page, 'posts', id, { title: 'Keyboard after' })

		await gotoLogs(page, `?documentId=${id}&operation=update`)

		const row = rows(page).first()
		await rowSummary(row).focus()
		await page.keyboard.press('Enter')

		await expect(row.locator('.al-diff')).toBeVisible()
	})

	test('filters from the url render as pills and narrow the list', async ({ page }) => {
		await gotoLogs(page, '?collection=posts')

		await expect(filterPills(page).first()).toBeVisible()
		// Rows name the collection by label; the slug is on the link's title.
		const titles = await rows(page)
			.locator('.al-row__collection')
			.evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''))
		expect(titles.length).toBeGreaterThan(0)
		expect(titles.every((title) => title.endsWith('posts'))).toBe(true)
	})

	test('an operation filter keeps only that operation', async ({ page }) => {
		await gotoLogs(page, '?operation=create')

		const badges = await rows(page).locator('.al-badge--op').allTextContents()
		expect(badges.length).toBeGreaterThan(0)
		expect(new Set(badges.map((b) => b.trim().toLowerCase()))).toEqual(new Set(['create']))
	})

	// Next hands the view a repeated key as an array, TanStack Start as `operation[0]`,
	// `operation[1]`; both have to narrow the list.
	test('several operations from the url keep only those operations', async ({ page }) => {
		await gotoLogs(page, '?operation=create&operation=delete')

		await expect(page.locator('.al-choice--active').first()).toContainText('Create')
		const badges = await rows(page).locator('.al-badge--op').allTextContents()
		expect(badges.length).toBeGreaterThan(0)
		expect(badges.every((b) => ['create', 'delete'].includes(b.trim().toLowerCase()))).toBe(true)
	})

	test('the event popup stages a switch until Apply', async ({ page }) => {
		await gotoLogs(page)

		await page.locator('.al-choice').filter({ hasText: 'Event' }).click()
		const update = page
			.locator('.al-event-filter__item')
			.filter({ has: page.getByText('Update', { exact: true }) })
		await update.locator('.switch').click()
		await expect(page).not.toHaveURL(/operation=update/)

		await page.getByRole('button', { name: 'Apply' }).click()
		await expect(page).toHaveURL(/operation=update/)
		// The URL moves before the new list renders, on TanStack Start visibly so.
		const badges = rows(page).locator('.al-badge--op')
		await expect(badges.filter({ hasNotText: /^update$/i })).toHaveCount(0)
		await expect(badges.first()).toHaveText(/update/i)
	})

	test('a filter that matches nothing shows the empty state', async ({ page }) => {
		await page.goto('/admin/audit-logs?documentId=does-not-exist')

		await expect(page.locator('.al-list__empty')).toBeVisible()
		expect(await rows(page).count()).toBe(0)
	})

	test('the header offers the retention jobs', async ({ page }) => {
		await gotoLogs(page)

		// The stand sets `debug: true` with retention configured, so both buttons render.
		const header = page.locator('.al-view__header')
		await expect(header.getByRole('button', { name: 'Run Archive' })).toBeVisible()
		await expect(header.getByRole('button', { name: 'Run Delete' })).toBeVisible()
	})

	test('a document shows core authorship through the plugin field', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Authorship test' })
		await page.goto(`/admin/collections/posts/${id}`)

		// The stand turns `authorshipFields` on for posts.
		for (const name of ['createdBy', 'updatedBy']) {
			await expect(page.locator(`#field-${name} .audit-relationship-field__link`)).toHaveText(
				'dev@10xmedia.de'
			)
		}
	})

	test('an excluded field never reaches the log', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Excluded test' })
		await updateDoc(page, 'posts', id, { internalNotes: 'invisible' })

		await page.goto(`/admin/audit-logs?documentId=${id}&operation=update`)

		await expect(page.locator('.al-list__empty')).toBeVisible()
	})

	test('an anonymized field is recorded as changed but redacted', async ({ page }) => {
		const id = await createDoc(page, 'posts', { title: 'Redaction test', apiKey: 'sk-one' })
		await updateDoc(page, 'posts', id, { apiKey: 'sk-two' })

		await gotoLogs(page, `?documentId=${id}&operation=update`)

		const row = rows(page).first()
		await rowSummary(row).click()

		await expect(row.locator('.al-diff__path').first()).toHaveText('apiKey')
		await expect(row.locator('.al-diff')).toContainText('__REDACTED__')
		await expect(row.locator('.al-diff')).not.toContainText('sk-two')
	})

	/**
	 * The only tier that exercises the real path. A refused login is recorded from the
	 * collection's `afterError` hook, which Payload calls from its REST error handler, so
	 * nothing below an actual HTTP request reaches it.
	 */
	test('a refused login is recorded without naming a user', async ({ page }) => {
		const attempt = await page.request.post('/api/users/login', {
			data: { email: 'intruder@example.com', password: 'wrong-password' },
			failOnStatusCode: false,
		})
		expect(attempt.status()).toBe(401)

		await gotoLogs(page, '?eventType=failed_login')

		const row = rows(page).first()
		await expect(row.locator('.al-badge--op')).toHaveText('Failed login')
		await expect(row.locator('.al-row__user')).toHaveText('—')

		await rowSummary(row).click()
		await expect(row).toContainText('intruder@example.com')
		await expect(row).not.toContainText('wrong-password')
	})

	test('a global entry is named by its label, with the slug on hover', async ({ page }) => {
		await gotoLogs(page, '?global=site-settings')

		const titles = await rows(page)
			.locator('.al-row__collection')
			.evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''))
		expect(titles.length).toBeGreaterThan(0)
		expect(titles.every((title) => title.endsWith('site-settings'))).toBe(true)
	})
})

test.describe('unauthenticated', () => {
	test('redirects to the login page instead of a placeholder', async ({ page }) => {
		await page.goto('/admin/audit-logs')

		await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
	})

	test('carries the filters through the redirect', async ({ page }) => {
		await page.goto('/admin/audit-logs?collection=posts&operation=update')
		await expect(page).toHaveURL(/\/admin\/login\?redirect=/)

		const redirect = new URL(page.url()).searchParams.get('redirect')
		expect(redirect).toBe('/admin/audit-logs?collection=posts&operation=update')
	})

	test('returns to the filtered list after signing in', async ({ page }) => {
		await page.goto('/admin/audit-logs?operation=create')

		await page.fill('#field-email', 'dev@10xmedia.de')
		await page.fill('#field-password', 'password')
		await page.click('form button[type="submit"]')

		await expect(page).toHaveURL(/\/admin\/audit-logs\?operation=create$/)
	})
})
