import { expect, type Page, test } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }
const CUSTOMER = { email: 'customer@10xmedia.de', password: 'password' }
const PARTNER = { email: 'partner@10xmedia.de', password: 'password' }

const ADMIN_COOKIE = 'payload-token'
const CUSTOMER_COOKIE = 'payload-customers-token'
const PARTNER_COOKIE = 'partner-session'

/**
 * Logs in through the REST endpoint the browser would hit anyway, so the cookie under test is
 * the one the plugin actually writes. `page.request` shares the page's cookie jar, which is
 * the whole point: every assertion below is about one browser holding several sessions.
 */
const login = async (page: Page, collection: string, data: Record<string, string>) => {
	const response = await page.request.post(`/api/${collection}/login`, { data })
	expect(response.ok(), `${collection} login`).toBeTruthy()
}

const cookieNames = async (page: Page) =>
	(await page.context().cookies()).map(({ name }) => name).sort()

const cookieValue = async (page: Page, name: string) =>
	(await page.context().cookies()).find((cookie) => cookie.name === name)?.value

/**
 * Fetches from inside the loaded document, so the request carries the `Referer` the proxy
 * attributes API calls by. `page.request` sends none, which leaves the request
 * unattributed: fine for a lone frontend session, but resolved in the admin's favour as
 * soon as one is live, which is not what a call from the website means.
 */
const fetchFromPage = (page: Page, path: string, init?: { method?: string }) =>
	page.evaluate(
		async ([target, method]) => {
			const response = await fetch(target as string, {
				credentials: 'include',
				method: (method as string) || 'GET',
			})
			return { body: await response.text(), status: response.status }
		},
		[path, init?.method] as const
	)

test.beforeEach(async ({ context }) => {
	await context.clearCookies()
})

test('one browser holds an admin and a frontend session at once', async ({ page }) => {
	await login(page, 'users', ADMIN)
	await login(page, 'customers', CUSTOMER)

	expect(await cookieNames(page)).toEqual([CUSTOMER_COOKIE, ADMIN_COOKIE].sort())

	await page.goto('/')

	// The two scopes disagree, which is the thing that was impossible before the plugin:
	// one cookie meant one answer for the whole browser.
	await expect(page.getByTestId('scope-admin')).toHaveText(`users · ${ADMIN.email}`)
	await expect(page.getByTestId('scope-frontend')).toHaveText(`customers · ${CUSTOMER.email}`)
})

test('the admin panel stays reachable while a frontend session is live', async ({ page }) => {
	await login(page, 'users', ADMIN)
	await login(page, 'customers', CUSTOMER)

	const response = await page.goto('/admin')

	expect(response?.status()).toBeLessThan(400)
	// Before the plugin the customer token overwrote the admin one and this bounced.
	await expect(page).not.toHaveURL(/\/admin\/(login|unauthorized)/)

	// Attributed to /admin by its Referer, so this is the admin panel asking who it is.
	const me = await fetchFromPage(page, '/api/users/me')
	expect(me.status).toBe(200)
	expect(JSON.parse(me.body).user?.email).toBe(ADMIN.email)
})

test('logging in on the website leaves the admin cookie untouched', async ({ page }) => {
	await login(page, 'users', ADMIN)
	const before = await cookieValue(page, ADMIN_COOKIE)

	await login(page, 'customers', CUSTOMER)

	expect(await cookieValue(page, ADMIN_COOKIE)).toBe(before)
})

test('the listed order decides which frontend session wins', async ({ page }) => {
	await login(page, 'customers', CUSTOMER)
	await login(page, 'partners', PARTNER)

	await page.goto('/')

	// `partners` is listed first in the plugin's `collections`, so it outranks the customer
	// session even though `customers` comes first in the config.
	await expect(page.getByTestId('scope-frontend')).toHaveText(`partners · ${PARTNER.email}`)
})

test('logging out of a frontend session keeps the admin one', async ({ page }) => {
	await login(page, 'users', ADMIN)
	await login(page, 'customers', CUSTOMER)

	await page.goto('/')
	const response = await fetchFromPage(page, '/api/customers/logout', { method: 'POST' })
	expect(response.status).toBe(200)

	expect(await cookieNames(page)).toEqual([ADMIN_COOKIE])
})

test('a custom SSO callback signs in without disturbing the admin session', async ({ page }) => {
	await login(page, 'users', ADMIN)
	const adminToken = await cookieValue(page, ADMIN_COOKIE)

	await page.goto('/')
	await page.getByTestId('sso-login').click()
	await page.waitForURL('/')

	// The callback mints its own token and writes it with generateIsolatedAuthCookie. A stock
	// one calling generatePayloadCookie would have replaced the admin token instead.
	expect(await cookieNames(page)).toEqual([CUSTOMER_COOKIE, ADMIN_COOKIE].sort())
	expect(await cookieValue(page, ADMIN_COOKIE)).toBe(adminToken)

	await expect(page.getByTestId('scope-frontend')).toHaveText(`customers · ${CUSTOMER.email}`)
	await expect(page.getByTestId('scope-admin')).toHaveText(`users · ${ADMIN.email}`)
})

test('an admin-only browser is still an admin on the website', async ({ page }) => {
	await login(page, 'users', ADMIN)

	await page.goto('/')

	// The shared cookie is never gated by scope, so a browser with no frontend session keeps
	// working exactly as it did before the plugin was installed.
	await expect(page.getByTestId('live-user')).toHaveText(`users · ${ADMIN.email}`)
})

test('an unattributed call still resolves a lone frontend session', async ({ page }) => {
	await login(page, 'customers', CUSTOMER)

	// No `Referer`, so the proxy sends no scope. With no admin session to defer to, the
	// customer cookie is the only answer there is. This is what an SSR fetch or a native
	// client looks like from the server's side.
	const response = await page.request.get('/api/customers/me')

	expect(response.status()).toBe(200)
	expect((await response.json()).user?.email).toBe(CUSTOMER.email)
})

test('an unattributed call defers to a live admin session', async ({ page }) => {
	await login(page, 'users', ADMIN)
	await login(page, 'customers', CUSTOMER)

	const response = await page.request.get('/api/customers/me')

	expect((await response.json()).user).toBeFalsy()
})

test('partners use the cookie name the plugin was configured with', async ({ page }) => {
	await login(page, 'partners', PARTNER)

	expect(await cookieNames(page)).toEqual([PARTNER_COOKIE])
})
