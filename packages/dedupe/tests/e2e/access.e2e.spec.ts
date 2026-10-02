import { expect, test } from '@playwright/test'

import {
	cleanup,
	createCustomer,
	findPair,
	login,
	MERGE_PATH,
	matchingPair,
	QUEUE_PATH,
} from './helpers'

/** A signed-out reader: custom admin views do their own redirect, so it is worth asserting. */
test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('the queue sends a stranger to the login screen and remembers where they were going', async ({
		page,
	}) => {
		await page.goto(`${QUEUE_PATH}?collection=customers&status=stale`)
		await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
		const redirect = new URL(page.url()).searchParams.get('redirect') ?? ''
		expect(decodeURIComponent(redirect)).toContain('/admin/dedupe')
		expect(decodeURIComponent(redirect)).toContain('status=stale')
		await expect(page.locator('#field-email')).toBeVisible()
	})

	test('the merge screen does the same', async ({ page }) => {
		await page.goto(`${MERGE_PATH}?collection=customers&docs=1,2&survivor=1`)
		await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
	})

	test('the endpoints answer 401 rather than data', async ({ request }) => {
		for (const path of ['/api/dedupe/plan', '/api/dedupe/scan']) {
			const response = await request.fetch(path, { method: 'POST' })
			expect(response.status(), path).toBe(401)
		}
	})
})

test.describe('signed in', () => {
	test.beforeEach(async ({ context }) => {
		await login(context)
	})

	test.afterAll(async ({ browser }) => {
		const context = await browser.newContext()
		await login(context)
		await cleanup(context.request)
		await context.close()
	})

	test('signing in through the form lands on the queue that was asked for', async ({
		page,
		context,
	}) => {
		await context.clearCookies()
		await page.goto(QUEUE_PATH)
		await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
		await page.locator('#field-email').fill('dev@10xmedia.de')
		await page.locator('#field-password').fill('password')
		await page.getByRole('button', { name: 'Login' }).click()
		await expect(page.locator('.dedupe-queue')).toBeVisible({ timeout: 30_000 })
	})

	test('not duplicates needs the documents, then marks and reopens them', async ({ context }) => {
		await cleanup(context.request)
		const [a, b] = matchingPair('nobody')
		const left = await createCustomer(context.request, a)
		const right = await createCustomer(context.request, b)

		const empty = await context.request.post('/api/dedupe/dismiss')
		expect(empty.status(), 'a request without a body is refused, not a crash').toBe(400)
		for (const action of ['dismiss', 'reopen'] as const) {
			const response = await context.request.post(`/api/dedupe/${action}`, {
				data: { collection: 'customers', docs: [left.id, right.id] },
			})
			expect(response.status(), action).toBe(200)
		}
		expect((await findPair(context.request, [left.id, right.id]))?.status).toBe('open')
	})

	test('the plan endpoint refuses an incomplete request', async ({ context }) => {
		const response = await context.request.post('/api/dedupe/plan', {
			data: { collection: 'customers' },
		})
		expect(response.status()).toBe(400)
		expect((await response.json()).message).toContain('required')
	})

	test('the apply endpoint refuses a plan with an unanswered manual field', async ({ context }) => {
		await cleanup(context.request)
		const [a, b] = matchingPair('guard', {
			a: { profile: { score: 3 } },
			b: { profile: { score: 4 } },
		})
		const survivor = await createCustomer(context.request, a)
		const absorbed = await createCustomer(context.request, b)

		const response = await context.request.post('/api/dedupe/apply', {
			data: {
				collection: 'customers',
				survivor: survivor.id,
				absorbed: [absorbed.id],
				choices: {},
			},
		})
		expect(response.status()).toBe(400)
		expect((await response.json()).message).toContain('profile.score')
	})
})
