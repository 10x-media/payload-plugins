import { expect, type Page, test } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }
const EDITOR = { email: 'editor@10xmedia.de', password: 'password' }

/** Fills and submits the login form already on screen, so a client-side session can carry on. */
const submitLogin = async (page: Page, account: { email: string; password: string }) => {
	await page.locator('#field-email, input[name="email"]').first().fill(account.email)
	await page.locator('#field-password, input[name="password"]').first().fill(account.password)
	await page.getByRole('button', { name: /log in|login/i }).click()
	await page.waitForURL(/\/admin/)
	await expect(page).not.toHaveURL(/\/admin\/login/)
}

const login = async (page: Page, account = ADMIN) => {
	await page.goto('/admin/login')
	await submitLogin(page, account)
}

const collectionLabel = (slug: string) =>
	({ customers: 'Customers', partners: 'Partners', users: 'Users' })[slug] ?? slug

const startAs = async (page: Page, name: string, collection?: string) => {
	await page.locator('.impersonation-switcher-button').click()
	const drawer = page.locator('.impersonation-switcher-drawer')
	await expect(drawer).toBeVisible()
	if (collection) {
		await drawer.locator('.impersonation-collection').click()
		await page
			.locator('.popup-button-list:visible')
			.getByText(collectionLabel(collection), { exact: true })
			.click()
	}
	await drawer.locator('.search-input__input').fill(name)
	await drawer.locator('.impersonation-card__pick').filter({ hasText: name }).click()
	const confirm = page.locator('.impersonation-confirm-modal:visible')
	await expect(confirm).toBeVisible()
	await confirm.getByRole('button', { name: 'Impersonate', exact: true }).click()
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

/** Opens a user's document through the admin's own links, so the root layout is not rendered again. */
const openUserInApp = async (page: Page, email: string) => {
	const listed = await page.request.get(`/api/users?where[email][equals]=${email}&limit=1`)
	expect(listed.ok()).toBeTruthy()
	const id = (await listed.json()).docs[0].id
	await page.locator('.template-default__wrap a[href$="/admin/collections/users"]').first().click()
	await page.locator(`a[href$="/admin/collections/users/${id}"]`).first().click()
	await expect(page.locator('#field-email')).toBeVisible()
	await page.waitForLoadState('networkidle')
}

test('a viewer that filterTargets excludes gets no switcher right after login', async ({
	page,
}) => {
	await login(page, EDITOR)
	await page.waitForLoadState('networkidle')
	await expect(page.locator('.impersonation-switcher-button')).toHaveCount(0)
})

test('a viewer that filterTargets excludes gets no document action after login', async ({
	page,
}) => {
	await login(page, EDITOR)
	await openUserInApp(page, 'user@10xmedia.de')
	await expect(page.locator('.impersonation-document-button')).toHaveCount(0)
})

test('staff get the document action after login without a reload', async ({ page }) => {
	await login(page)
	await openUserInApp(page, 'editor@10xmedia.de')
	await expect(page.locator('.impersonation-document-button')).toBeVisible()
})

test('a viewer that filterTargets excludes never sees the switcher after another user leaves', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const probe = window as unknown as { switcherSeen?: number }
		probe.switcherSeen = 0
		new MutationObserver(() => {
			if (document.querySelector('.impersonation-switcher-button')) {
				probe.switcherSeen = (probe.switcherSeen ?? 0) + 1
			}
		}).observe(document, { childList: true, subtree: true })
	})
	await login(page)
	await expect(page.locator('.impersonation-switcher-button')).toBeVisible()
	await page.evaluate(() => {
		;(window as unknown as { stays?: boolean }).stays = true
	})
	// The logout link sits in the collapsed nav, so no pointer reaches it; the dispatched click still
	// runs the link's client-side navigation.
	await page.locator('a[href$="/admin/logout"]').first().dispatchEvent('click')
	await page.waitForURL(/\/admin\/login/)
	await page.evaluate(() => {
		;(window as unknown as { switcherSeen?: number }).switcherSeen = 0
	})
	await submitLogin(page, EDITOR)
	await page.waitForLoadState('networkidle')
	expect(await page.evaluate(() => (window as unknown as { stays?: boolean }).stays)).toBe(true)
	expect(
		await page.evaluate(() => (window as unknown as { switcherSeen?: number }).switcherSeen)
	).toBe(0)
})

test('staff can switch to a user and return', async ({ page }) => {
	await login(page)
	await startAs(page, 'Dev Editor')
	await expect(page.locator('.impersonation-bar')).toContainText('Acting as')
	await page.getByRole('button', { name: /Return to/ }).click()
	await expect(page.locator('.impersonation-switcher-button')).toBeVisible()
})

test('reopening the picker clears the previous search', async ({ page }) => {
	await login(page)
	const drawer = page.locator('.drawer--is-open')
	const cards = drawer.locator('.impersonation-card__pick')

	await page.locator('.impersonation-switcher-button').click()
	await expect(cards.first()).toBeVisible()
	const unfiltered = await cards.count()
	expect(unfiltered).toBeGreaterThan(1)

	await drawer.locator('.search-input__input').fill('Dev Editor')
	await expect(cards).toHaveCount(1)

	await drawer.locator('.drawer__header__close').click()
	await expect(drawer).toHaveCount(0)

	await page.locator('.impersonation-switcher-button').click()
	await expect(drawer.locator('.search-input__input')).toHaveValue('')
	await expect(cards).toHaveCount(unfiltered)
})

test('bar stays on /admin/unauthorized for a non-staff target', async ({ page }) => {
	await login(page)
	await startAs(page, 'Dev User')
	await expect(page).toHaveURL(/\/admin\/unauthorized/)
	await expect(page.locator('.impersonation-bar')).toContainText('Acting as')
	await page.getByRole('button', { name: /Return to/ }).click()
	await expect(page.locator('.impersonation-switcher-button')).toBeVisible()
})

test('document action starts impersonation', async ({ page }) => {
	await login(page)
	const listed = await page.request.get(
		'/api/users?where[email][equals]=editor@10xmedia.de&limit=1'
	)
	expect(listed.ok()).toBeTruthy()
	const id = (await listed.json()).docs[0].id
	await page.goto(`/admin/collections/users/${id}`)
	await page.locator('.impersonation-document-button').click()
	const confirm = page.locator('.impersonation-confirm-modal:visible')
	await expect(confirm).toBeVisible()
	await confirm.getByRole('button', { name: 'Impersonate', exact: true }).click()
	await expect(page.locator('.impersonation-bar')).toContainText('Acting as')
})

test('logout while impersonating closes the session', async ({ page }) => {
	await login(page)
	await startAs(page, 'Dev Editor')
	await expect(page.locator('.impersonation-bar')).toContainText('Acting as')
	const status = await page.evaluate(async () => {
		const response = await fetch('/api/users/logout', { credentials: 'include', method: 'POST' })
		return response.status
	})
	expect(status).toBeLessThan(400)
	await page.goto('/')
	await expect(page.locator('.dev-impersonation-status')).toHaveText('not impersonating')
})

test('terminate from the record ends the other session', async ({ browser, page }) => {
	await login(page)
	await startAs(page, 'Dev Editor')
	await expect(page.locator('.impersonation-bar')).toContainText('Acting as')

	const terminator = await browser.newContext()
	const other = await terminator.newPage()
	try {
		await login(other)
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
		await expect(page.locator('.impersonation-bar')).toHaveCount(0)
	} finally {
		await terminator.close()
	}
})

test('frontend helper reports a customer impersonation', async ({ page }) => {
	await login(page)
	await startAs(page, 'Dev Customer', 'customers')
	await expect(page.locator('.dev-impersonation-status')).toContainText(
		'impersonating as customers/'
	)
	await page.locator('.impersonation-frontend-banner__exit').click()
	await expect(page.locator('.dev-impersonation-status')).toHaveText('not impersonating')
})

test('a partner session keeps the admin and ends from the quiet bar', async ({ page }) => {
	await login(page)
	await startAs(page, 'Dev Partner', 'partners')
	await expect(page.locator('.dev-impersonation-status')).toContainText(
		'impersonating as partners/'
	)
	await page.goto('/admin')
	const bar = page.locator('.impersonation-bar--quiet')
	await expect(bar).toContainText('Dev Partner session is active on the website')
	await bar.getByRole('button', { name: 'End session', exact: true }).click()
	await expect(page.locator('.impersonation-bar')).toHaveCount(0)
	await expect(page.locator('.impersonation-switcher-button')).toBeVisible()
})
