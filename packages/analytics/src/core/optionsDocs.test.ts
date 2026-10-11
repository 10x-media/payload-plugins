import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { optionPaths } from '../testing/optionPaths'

const PAGE = new URL(
	'../../../../apps/docs/content/docs/analytics/reference/options.mdx',
	import.meta.url
)

describe('the options reference', () => {
	const paths = optionPaths().map((option) => option.path)
	const page = readFileSync(PAGE, 'utf8')

	it('reads the option paths off the type, nested and keyed ones included', () => {
		expect(paths.length).toBeGreaterThan(100)
		expect(paths).toEqual(
			expect.arrayContaining([
				'adapters',
				'capture.gate',
				'capture.autoCapture.items.impressions',
				'access.crossScope.unscopedSource',
				'collections.<slug>.scopeField',
				'widgets.overrides.<slug>.Component',
				'jobs.tasks.maintain.cron',
				'providers.collection.connectionAccess.update',
				'sync.collection.hidden',
			])
		)
		expect(paths).not.toContain('cache.store.get')
		expect(paths).not.toContain('sdks.ga4.BetaAnalyticsDataClient')
	})

	it('names every option path in backticks', () => {
		const missing = paths.filter((path) => !page.includes(`\`${path}\``))
		expect(missing, `reference/options.mdx does not document: ${missing.join(', ')}`).toEqual([])
	})
})
