import { expect, type Page, test } from '@playwright/test'

const ADMIN = { email: 'dev@10xmedia.de', password: 'password' }
/** Same collection, no staff role, so the `isolate` predicate moves this one. */
const MEMBER = { email: 'member@10xmedia.de', password: 'password' }

const ADMIN_COOKIE = 'payload-token'
const MEMBER_COOKIE = 'payload-users-token'

const login = async (page: Page, data: Record<string, string>) => {
	const response = await page.request.post('/api/users/login', { data })
	expect(response.ok(), `login as ${data.email}`).toBeTruthy()
}

const cookieNames = async (page: Page) =>
	(await page.context().cookies()).map(({ name }) => name).sort()

const cookieValue = async (page: Page, name: string) =>
	(await page.context().cookies()).find((cookie) => cookie.name === name)?.value

/** Fetches from inside the loaded document, so the proxy sees a `Referer` to attribute by. */
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

test('one login route, two cookies, decided by the document', async ({ page }) => {
	await login(page, ADMIN)
	expect(await cookieNames(page)).toEqual([ADMIN_COOKIE])

	await page.context().clearCookies()

	await login(page, MEMBER)
	expect(await cookieNames(page)).toEqual([MEMBER_COOKIE])
})

test('one browser holds two sessions from the same collection', async ({ page }) => {
	await login(page, ADMIN)
	const adminToken = await cookieValue(page, ADMIN_COOKIE)

	await login(page, MEMBER)

	// The second login of the same collection used to be the first one's replacement.
	expect(await cookieNames(page)).toEqual([ADMIN_COOKIE, MEMBER_COOKIE].sort())
	expect(await cookieValue(page, ADMIN_COOKIE)).toBe(adminToken)

	await page.goto('/')

	await expect(page.getByTestId('scope-admin')).toHaveText(`users · ${ADMIN.email}`)
	await expect(page.getByTestId('scope-frontend')).toHaveText(`users · ${MEMBER.email}`)
})

test('the admin panel belongs to the admin while the member session is live', async ({ page }) => {
	await login(page, ADMIN)
	await login(page, MEMBER)

	const response = await page.goto('/admin')

	expect(response?.status()).toBeLessThan(400)
	await expect(page).not.toHaveURL(/\/admin\/(login|unauthorized)/)

	// Attributed to /admin by its Referer. Both users are `users`, so only the cookie tells
	// them apart, which is the whole mechanism.
	const me = await fetchFromPage(page, '/api/users/me')
	expect(JSON.parse(me.body).user?.email).toBe(ADMIN.email)
})

test('a member alone cannot reach the admin panel', async ({ page }) => {
	await login(page, MEMBER)

	await page.goto('/admin')

	// The member's session never lands in the cookie the panel reads, so this is the plain
	// logged-out experience rather than a half-authenticated one.
	await expect(page).toHaveURL(/\/admin\/(login|unauthorized)/)
})

test('logging the member out leaves the admin session alone', async ({ page }) => {
	await login(page, ADMIN)
	await login(page, MEMBER)

	await page.goto('/')
	const response = await fetchFromPage(page, '/api/users/logout', { method: 'POST' })
	expect(response.status).toBe(200)

	expect(await cookieNames(page)).toEqual([ADMIN_COOKIE])

	await page.goto('/')
	await expect(page.getByTestId('scope-admin')).toHaveText(`users · ${ADMIN.email}`)
})

test('access control, not the plugin, decides what a member may write', async ({ page }) => {
	await login(page, MEMBER)
	await page.goto('/')

	// `req.user.collection` is `users` for the member too, so the boundary the second
	// collection used to draw physically is now entirely `adminOnly`'s job.
	const notes = await fetchFromPage(page, '/api/notes')
	expect(notes.status).toBe(200)

	const write = await fetchFromPage(page, '/api/globals/site-settings', { method: 'POST' })
	expect(write.status).toBe(403)
})
