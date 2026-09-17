import { expect, type Page, test } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }

const loginAdmin = async (page: Page) => {
	await page.goto('/admin/login')
	await page.locator('#field-email, input[name="email"]').first().fill(ADMIN.email)
	await page.locator('#field-password, input[name="password"]').first().fill(ADMIN.password)
	await page.getByRole('button', { name: /log in|login/i }).click()
	await page.waitForURL(/\/admin/)
	await expect(page).not.toHaveURL(/\/admin\/login/)
}

const collectionLabel = (slug: string) =>
	({ customers: 'Customers', partners: 'Partners', users: 'Users' })[slug] ?? slug

const startAs = async (page: Page, name: string, collection?: string) => {
	await page.getByTestId('impersonation-switcher').click()
	const drawer = page.locator('.drawer--is-open, .drawer')
	await expect(drawer).toBeVisible()
	if (collection) {
		await drawer.locator('.react-select').first().click()
		await page.getByRole('option', { name: collectionLabel(collection), exact: true }).click()
	}
	await drawer.getByRole('button', { name, exact: true }).click()
	const confirm = page.locator('.confirmation-modal')
	await expect(confirm).toBeVisible()
	await confirm.getByRole('button', { name: 'Switch', exact: true }).click()
}

const revealMenuItem = async (page: Page, testId: string) => {
	const item = page.getByTestId(testId)
	if (await item.isVisible()) {
		return item
	}
	await page.locator('.popup-button').last().click()
	await expect(item).toBeVisible()
	return item
}

test('admin panel loads with impersonation plugin enabled', async ({ page }) => {
	const response = await page.goto('/admin')
	expect(response?.status()).toBeLessThan(500)
	await expect(page.locator('body')).toBeVisible()
})

test('payload health endpoint responds', async ({ request }) => {
	const response = await request.get('/admin')
	expect(response.status()).toBeLessThan(500)
})

test('staff can switch to a user and return', async ({ page }) => {
	await loginAdmin(page)
	await startAs(page, 'Dev Editor')
	await expect(page.getByTestId('impersonation-bar')).toContainText('Acting as')
	await page.getByRole('button', { name: /Return to/ }).click()
	await expect(page.getByTestId('impersonation-switcher')).toBeVisible()
})

test('bar stays on /admin/unauthorized for a non-staff target', async ({ page }) => {
	await loginAdmin(page)
	await startAs(page, 'Dev User')
	await expect(page).toHaveURL(/\/admin\/unauthorized/)
	await expect(page.getByTestId('impersonation-bar')).toContainText('Acting as')
	await page.getByRole('button', { name: /Return to/ }).click()
	await expect(page.getByTestId('impersonation-switcher')).toBeVisible()
})

test('document action starts impersonation', async ({ page }) => {
	await loginAdmin(page)
	const listed = await page.request.get(
		'/api/users?where[email][equals]=editor@10xmedia.de&limit=1'
	)
	expect(listed.ok()).toBeTruthy()
	const id = (await listed.json()).docs[0].id
	await page.goto(`/admin/collections/users/${id}`)
	await (await revealMenuItem(page, 'impersonation-document-action')).click()
	const confirm = page.locator('.confirmation-modal')
	await expect(confirm).toBeVisible()
	await confirm.getByRole('button', { name: 'Switch', exact: true }).click()
	await expect(page.getByTestId('impersonation-bar')).toContainText('Acting as')
})

test('logout while impersonating closes the session', async ({ page }) => {
	await loginAdmin(page)
	await startAs(page, 'Dev Editor')
	await expect(page.getByTestId('impersonation-bar')).toContainText('Acting as')
	const status = await page.evaluate(async () => {
		const response = await fetch('/api/users/logout', { credentials: 'include', method: 'POST' })
		return response.status
	})
	expect(status).toBeLessThan(400)
	await page.goto('/')
	await expect(page.getByTestId('impersonation-status')).toHaveText('not impersonating')
})

test('terminate from the record ends the other session', async ({ browser, page }) => {
	await loginAdmin(page)
	await startAs(page, 'Dev Editor')
	await expect(page.getByTestId('impersonation-bar')).toContainText('Acting as')

	const terminator = await browser.newContext()
	const other = await terminator.newPage()
	try {
		await loginAdmin(other)
		const listed = await other.request.get(
			'/api/impersonation-sessions?where[endedAt][exists]=false&limit=1&depth=0'
		)
		expect(listed.ok()).toBeTruthy()
		const row = (await listed.json()).docs[0]
		expect(row?.id).toBeTruthy()
		const ended = await other.evaluate(async (id) => {
			const response = await fetch(`/api/impersonation/${id}/end`, {
				body: '{}',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				method: 'POST',
			})
			return { ok: response.ok, status: response.status }
		}, row.id)
		expect(ended.ok, `terminate ${ended.status}`).toBeTruthy()
		await page.reload()
		await expect(page.getByTestId('impersonation-bar')).toHaveCount(0)
	} finally {
		await terminator.close()
	}
})

test('frontend helper reports a customer impersonation', async ({ page }) => {
	await loginAdmin(page)
	await startAs(page, 'Dev Customer', 'customers')
	await expect(page.getByTestId('impersonation-status')).toContainText(
		'impersonating as customers/'
	)
	await page.getByTestId('impersonation-exit').click()
	await expect(page.getByTestId('impersonation-status')).toHaveText('not impersonating')
})
