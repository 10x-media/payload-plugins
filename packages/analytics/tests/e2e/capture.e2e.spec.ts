import { expect, type Page, test } from '@playwright/test'
import {
	docIdBySlug,
	ingested,
	localOrigin,
	login,
	readDocument,
	setTenantCookie,
	tenantId,
} from './helpers'

/**
 * Converts through auto-capture and a provider-less `useAnalytics().track`, awaiting each beacon
 * rather than polling a read: one taken too early pins an empty answer in the cache for minutes.
 */
const visitAndConvert = async (page: Page, origin = ''): Promise<void> => {
	const pageview = ingested(page)
	await page.goto(`${origin}/`)
	await pageview
	for (const name of ['Book a demo', 'Sign up']) {
		const sent = ingested(page)
		await page.getByRole('button', { name }).click()
		await sent
	}
}

test('a frontend visit and two goal clicks land as a pageview and conversions', async ({
	page,
}) => {
	await visitAndConvert(page)

	await login(page.request)
	const home = await docIdBySlug(page.request, 'home')
	const read = await readDocument(page.request, home, 'pageviews,conversions')
	expect(read.status).toBe('ok')
	expect(read.metrics?.pageviews ?? 0).toBeGreaterThanOrEqual(1)
	// One per button: the attribute goal and the tracked `signup` event.
	expect(read.metrics?.conversions ?? 0).toBeGreaterThanOrEqual(2)

	const realtime = await page.request.get('/api/_x/live?metric=pageviews')
	expect(realtime.ok()).toBeTruthy()
	const { activeNow } = (await realtime.json()) as { activeNow: number }
	expect(activeNow).toBeGreaterThanOrEqual(1)
})

test('the signed exclusion link stops beacons in this browser until it is cleared', async ({
	page,
}) => {
	await login(page.request)
	const link = await page.request.get('/api/_x/exclusion')
	expect(link.ok(), 'exclusion link').toBeTruthy()
	const { param, token } = (await link.json()) as { param: string; token: string }

	const posts: string[] = []
	page.on('request', (req) => {
		if (req.method() === 'POST' && req.url().includes('/api/_x/e')) {
			posts.push(req.url())
		}
	})

	// A link anyone could type is not the token, so the visit counts. The parameter still leaves
	// the address, which happens as it is read and before any check.
	const forged = ingested(page)
	await page.goto(`/?${param}=1`)
	await forged
	await expect(page).not.toHaveURL(new RegExp(param))

	posts.length = 0
	await page.goto(`/?${param}=${token}`)
	// The tracker takes a valid link out of the address once it has checked it, so a copied
	// address or a screenshot does not pass the token on.
	await expect(page).not.toHaveURL(new RegExp(param))
	await page.getByRole('button', { name: 'Book a demo' }).click()
	// The navigation is the barrier: the goal would have gone out on the click, and the page's
	// engagement on `pagehide`, all before the next page has loaded.
	await page.goto('/thank-you')
	expect(posts, 'no beacon while excluded').toEqual([])

	const resumed = ingested(page)
	await page.goto(`/?${param}=0`)
	await resumed
	// Only the cleared visit can have sent anything: the excluded pages were checked above
	// and this beacon is ordered after them in the same browser.
	expect(posts.length, 'beacons resume once the flag is cleared').toBeGreaterThanOrEqual(1)
	await expect(page).not.toHaveURL(new RegExp(param))
})

test('@tenancy an anonymous visit is attributed to the hostname tenant', async ({
	browser,
	baseURL,
}) => {
	const visitor = await browser.newContext()
	const visitorPage = await visitor.newPage()
	await visitAndConvert(visitorPage, localOrigin(baseURL, 'alpha'))
	await visitor.close()

	const admin = await browser.newContext()
	await login(admin.request)
	const home = await docIdBySlug(admin.request, 'home')

	// The platform admin reads any scope it selects, so one session can check both sides of
	// the boundary: the conversion belongs to alpha and must not appear under beta.
	await setTenantCookie(admin, await tenantId(admin.request, 'alpha'), localOrigin(baseURL))
	const alphaRead = await readDocument(admin.request, home, 'pageviews,conversions')
	expect(alphaRead.status).toBe('ok')
	expect(alphaRead.metrics?.conversions ?? 0).toBeGreaterThanOrEqual(2)

	// Beta's seeded pageviews on this path prove the read reached data: an empty scope would
	// pass a bare `conversions === 0` vacuously.
	await setTenantCookie(admin, await tenantId(admin.request, 'beta'), localOrigin(baseURL))
	const betaRead = await readDocument(admin.request, home, 'pageviews,conversions')
	expect(betaRead.status).toBe('ok')
	expect(betaRead.metrics).toBeDefined()
	expect(betaRead.metrics?.pageviews ?? 0).toBeGreaterThanOrEqual(1)
	expect(betaRead.metrics?.conversions).toBe(0)
	await admin.close()
})
