import { type APIRequestContext, test as base, chromium, expect } from '@playwright/test'
import { prerenderReadyTitle } from '../../dev/helpers/prerenderReady'
import { type DetachedChromium, launchDetachedChromium } from './detachedChromium'
import { ingested, login, nativeTotals, refreshReads } from './helpers'

/**
 * A Chromium of the test's own, one tab and no history. A fixture rather than a `finally` in the
 * test, so it is closed even when the test times out, which abandons the test body unwound.
 */
const test = base.extend<{ detached: DetachedChromium }>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern
	detached: async ({}, use) => {
		const detached = await launchDetachedChromium()
		try {
			await use(detached)
		} finally {
			await detached.close()
		}
	},
})

/** Visible time a page needs before its engagement is worth a message (`ENGAGEMENT_MIN_MS`). */
const ENGAGED_MS = 1_000

interface PathTotals {
	pageviews: number
	avgDuration: number
}

/** A published page of its own, so each check counts only the hits it caused. */
const createPage = async (request: APIRequestContext, prefix: string): Promise<string> => {
	const slug = `${prefix}-${Date.now()}`
	const res = await request.post('/api/pages', { data: { title: slug, slug } })
	expect(res.ok(), `create page ${slug}`).toBeTruthy()
	return `/${slug}`
}

/**
 * One path's native totals from raw hits. Each read first retires cached reads: a zero cached
 * before a beacon landed would otherwise answer every poll after it.
 */
const totalsFor = async (request: APIRequestContext, path: string): Promise<PathTotals> => {
	await refreshReads(request)
	const totals = await nativeTotals(request, { metrics: 'pageviews,avgDuration', path })
	return { pageviews: totals.pageviews ?? 0, avgDuration: totals.avgDuration ?? 0 }
}

test.describe('page lifecycle in a real browser', () => {
	test('a page another tab covers reports hidden, and its engaged time is recorded', async ({
		request,
		baseURL,
		detached,
	}) => {
		await login(request)
		const path = await createPage(request, 'covered')

		// The default context of a browser Playwright did not launch: no focus emulation, so a tab
		// brought to the front really hides the other one.
		const browser = await chromium.connectOverCDP(detached.wsEndpoint, { noDefaults: true })
		try {
			const [context] = browser.contexts()
			if (!context) {
				throw new Error('Chromium starts with a default context')
			}
			const covered = context.pages()[0] ?? (await context.newPage())
			const pageview = ingested(covered)
			await covered.goto(`${baseURL}${path}`)
			await pageview
			await covered.waitForTimeout(ENGAGED_MS + 500)

			const front = await context.newPage()
			await front.bringToFront()
			await expect.poll(() => covered.evaluate(() => document.visibilityState)).toBe('hidden')

			await expect
				.poll(async () => (await totalsFor(request, path)).avgDuration, { timeout: 15_000 })
				.toBeGreaterThanOrEqual(ENGAGED_MS)
			expect((await totalsFor(request, path)).pageviews).toBe(1)
		} finally {
			await browser.close()
		}
	})

	test('leaving a page sends its engaged time on pagehide', async ({ page, request }) => {
		await login(request)
		const path = await createPage(request, 'left')

		const pageview = ingested(page)
		await page.goto(path)
		await pageview
		await page.waitForTimeout(ENGAGED_MS + 500)
		await page.goto('/thank-you')

		await expect
			.poll(async () => (await totalsFor(request, path)).avgDuration, { timeout: 15_000 })
			.toBeGreaterThanOrEqual(ENGAGED_MS)
		expect((await totalsFor(request, path)).pageviews).toBe(1)
	})

	test('a prerendered thank-you page counts no pageview until it is opened, then exactly one', async ({
		request,
		baseURL,
		detached,
	}) => {
		test.setTimeout(90_000)
		await login(request)
		const path = await createPage(request, 'prerendered')

		await detached.open(`${baseURL}/prerender?to=${encodeURIComponent(path)}`)
		// The prerendered page's tracker booted once /prerender's title names it (the dev app's
		// PrerenderReady): read from the target list, since attaching would stop the prerender.
		await expect
			.poll(() => detached.title('/prerender'), { timeout: 30_000 })
			.toBe(prerenderReadyTitle(path))
		const checkedAt = Date.now()
		expect((await totalsFor(request, path)).pageviews).toBe(0)

		await detached.evaluate('/prerender', "document.querySelector('a[href]').click()")
		// The tab shows the thank-you page only once the click activated it.
		await expect
			.poll(() => detached.evaluate(path, 'document.readyState').catch(() => 'not yet'))
			.toBe('complete')
		const timing = await detached.evaluate(
			path,
			"(() => { const [nav] = performance.getEntriesByType('navigation'); return { activationStart: nav.activationStart, loadedAt: performance.timeOrigin + nav.loadEventEnd } })()"
		)
		expect(timing).toMatchObject({
			activationStart: expect.any(Number),
			loadedAt: expect.any(Number),
		})
		const { activationStart, loadedAt } = timing as { activationStart: number; loadedAt: number }
		// Opened from the prerender, and loaded, tracker and all, before the zero above was read.
		expect(activationStart).toBeGreaterThan(0)
		expect(loadedAt).toBeLessThan(checkedAt)

		await expect
			.poll(async () => (await totalsFor(request, path)).pageviews, { timeout: 15_000 })
			.toBe(1)
		await new Promise((resolve) => setTimeout(resolve, 2_000))
		expect((await totalsFor(request, path)).pageviews).toBe(1)
	})
})
