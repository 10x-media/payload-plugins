import { login, nativeTotals, refreshReads } from './helpers'
import {
	consent,
	expect,
	interact,
	type NativeBeacon,
	NOTHING_STORED,
	siteOrigin,
	storedNames,
	test,
} from './vendors/fixtures'

/**
 * e2e.sh boots this pass with `ANALYTICS_E2E_VENDORS=anonymous`: `native({ withoutConsent:
 * 'anonymous' })` on the global slot, held by `capture.gate: 'all'`.
 */

const modesOf = (beacons: NativeBeacon[]): string[] => [
	...new Set(beacons.map((beacon) => beacon.m ?? 'f')),
]

test('@vendors-anonymous native counts anonymously before an answer and after a refusal, in full once allowed, storing nothing', async ({
	page,
	baseURL,
	native,
}) => {
	await page.goto(`${siteOrigin(baseURL)}/`)
	await interact(page)
	await expect.poll(() => native.beacons().length).toBeGreaterThanOrEqual(3)
	expect(modesOf(native.beacons()), 'pending counts anonymously').toEqual(['a'])
	expect(await storedNames(page)).toEqual(NOTHING_STORED)

	const phases = [
		{ answer: consent.refuse, status: 'closed', mode: 'a' },
		{ answer: consent.allow, status: 'open', mode: 'f' },
		{ answer: consent.refuse, status: 'closed', mode: 'a' },
	] as const
	for (const { answer, status, mode } of phases) {
		const mark = native.beacons().length
		await answer(page)
		await consent.settled(page, 'global', status)
		await interact(page)
		await expect.poll(() => native.beacons().length).toBeGreaterThanOrEqual(mark + 2)
		expect(modesOf(native.beacons().slice(mark)), `once the gate is ${status}`).toEqual([mode])
		expect(await storedNames(page)).toEqual(NOTHING_STORED)
	}
})

test('@vendors-anonymous an anonymous pageview is stored as a pageview without a visitor', async ({
	page,
	request,
	baseURL,
	native,
}) => {
	await login(request)
	const slug = `anonymous-${Date.now()}`
	const created = await request.post('/api/pages', { data: { title: slug, slug } })
	expect(created.ok(), `create page ${slug}`).toBeTruthy()

	await page.goto(`${siteOrigin(baseURL)}/${slug}`)
	await expect.poll(() => native.beacons().some((b) => b.type === 'pageview')).toBe(true)
	expect(modesOf(native.beacons())).toEqual(['a'])

	const totals = async () => {
		await refreshReads(request)
		return nativeTotals(request, { metrics: 'pageviews,visitors', path: `/${slug}` })
	}
	await expect.poll(async () => (await totals()).pageviews ?? 0, { timeout: 15_000 }).toBe(1)
	expect((await totals()).visitors ?? 0, 'no visitor id was stored').toBe(0)
})
