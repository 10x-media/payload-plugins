import { type APIRequestContext, expect, test } from '@playwright/test'
import { docIdBySlug, login, refreshReads } from './helpers'

/**
 * e2e.sh boots this pass with `ANALYTICS_SLOW_SOURCE_MS=10000`, so the default source answers after
 * 10 s. No admin screen may wait on it to paint; half its delay leaves a cold `next start` room.
 */
const SLOW_MS = 10_000
const PAINTED_WITHIN_MS = SLOW_MS / 2

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ timeout: 60_000 })

const createPage = async (request: APIRequestContext, slug: string): Promise<string | number> => {
	const created = await request.post('/api/pages', { data: { title: slug, slug } })
	expect(created.ok(), `create page ${slug}`).toBeTruthy()
	const { doc } = (await created.json()) as { doc: { id: string | number } }
	return doc.id
}

test('@slow-source the edit view is editable before the slow read, and the Analytics tab paints before it answers', async ({
	page,
}) => {
	await login(page.request)
	// Every cached read retired, so the slow source is read cold again, a retried run included.
	await refreshReads(page.request)
	const slug = `slow-${Date.now()}`
	// A page with seeded traffic: a page created here reads all zeros, which the panel shows as new.
	const id = await docIdBySlug(page.request, 'pricing')

	// Warms the edit route on a throwaway document so the clock measures this one, not a cold
	// `next start`; that visit opens no Analytics tab, so the slow source stays cold.
	await page.goto(`/admin/collections/pages/${await createPage(page.request, `${slug}-warm`)}`)
	await expect(page.locator('#field-title')).toBeEditable()
	await page.goto('/admin/account')
	await expect(page.locator('#field-email')).toBeVisible()

	const started = Date.now()
	await page.goto(`/admin/collections/pages/${id}`, { waitUntil: 'commit' })
	const edited = `${slug} edited`
	await page.locator('#field-title').fill(edited)
	// The header repeats the title from the form's own state, which only a hydrated form updates.
	await expect(page.locator('.doc-header__title')).toHaveText(edited)
	expect(Date.now() - started).toBeLessThan(PAINTED_WITHIN_MS)

	const opened = Date.now()
	await page.locator('.tabs-field__tab-button', { hasText: 'Analytics' }).click()
	const body = page.locator('.analytics-panel .analytics-panel__body')
	await expect(page.locator('.analytics-panel__toolbar')).toBeVisible()
	await expect(body).toHaveAttribute('aria-busy', 'true')
	expect(Date.now() - opened).toBeLessThan(PAINTED_WITHIN_MS)

	// The lists are read once the headline has answered, so the panel takes two of the slow
	// source's turns; none of its reads waits long enough to time out.
	await expect(body).toHaveAttribute('aria-busy', 'false', { timeout: 2 * SLOW_MS + 15_000 })
	// The panel really waited on the slow source, so the shell above was painted ahead of it.
	expect(Date.now() - opened).toBeGreaterThan(SLOW_MS - 2_000)
	await expect(
		body.locator('.analytics-panel__card .analytics-metric__value').first()
	).toBeVisible()
	await expect(body.getByRole('alert')).toHaveCount(0)
})

test('@slow-source the dashboard paints its frame and the native card before the slow card resolves', async ({
	page,
}) => {
	await login(page.request)
	await refreshReads(page.request)

	// A card streams in hidden beside its loading frame and is swapped for it, so each state is its
	// own locator, narrowed to what is on screen, rather than a class one element changes.
	const card = (title: string, loading: boolean) =>
		page
			.locator(
				loading
					? '.analytics-metric-widget.analytics-widget--loading'
					: '.analytics-metric-widget:not(.analytics-widget--loading)',
				{ hasText: title }
			)
			.filter({ visible: true })

	const started = Date.now()
	await page.goto('/admin', { waitUntil: 'commit' })
	await expect(card('Native pageviews', false)).toBeVisible()
	await expect(card('Slow pageviews', true)).toBeVisible()
	await expect(card('Slow pageviews', false)).toHaveCount(0)
	expect(Date.now() - started).toBeLessThan(PAINTED_WITHIN_MS)

	await expect(card('Slow pageviews', false)).toBeVisible({ timeout: SLOW_MS + 10_000 })
	expect(Date.now() - started).toBeGreaterThan(SLOW_MS - 2_000)
	await expect(card('Slow pageviews', false).locator('.analytics-widget__value')).toBeVisible()
})
