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
		await expect(page.locator('.al-pagination__info')).toBeVisible()
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
		const collections = await rows(page).locator('.al-row__collection').allTextContents()
		expect(new Set(collections)).toEqual(new Set(['posts']))
	})

	test('an operation filter keeps only that operation', async ({ page }) => {
		await gotoLogs(page, '?operation=create')

		const badges = await rows(page).locator('.al-badge--op').allTextContents()
		expect(badges.length).toBeGreaterThan(0)
		expect(new Set(badges.map((b) => b.trim().toLowerCase()))).toEqual(new Set(['create']))
	})

	test('a filter that matches nothing shows the empty state', async ({ page }) => {
		await page.goto('/admin/audit-logs?documentId=does-not-exist')

		await expect(page.locator('.al-list__empty')).toBeVisible()
		expect(await rows(page).count()).toBe(0)
	})

	test('the debug bar offers the retention jobs', async ({ page }) => {
		await gotoLogs(page)

		// The stand sets `debug: true` with retention configured, so both buttons render.
		await expect(page.locator('.al-debug-bar__btn')).toHaveCount(2)
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
		await expect(row.locator('.al-badge--op')).toHaveText('failed_login')
		await expect(row.locator('.al-row__user')).toHaveText('—')

		await rowSummary(row).click()
		await expect(row).toContainText('intruder@example.com')
		await expect(row).not.toContainText('wrong-password')
	})

	test('a global entry is labelled by its slug', async ({ page }) => {
		await gotoLogs(page, '?global=site-settings')

		const collections = await rows(page).locator('.al-row__collection').allTextContents()
		expect(collections.length).toBeGreaterThan(0)
		expect(new Set(collections)).toEqual(new Set(['site-settings']))
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
