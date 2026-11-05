import { readFileSync } from 'node:fs'
import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { analytics } from '../index'
import { native } from '../native/nativeAdapter'

const PAGE = new URL(
	'../../../../apps/docs/content/docs/analytics/reference/endpoints.mdx',
	import.meta.url
)

/** An install that mounts every endpoint the plugin has: native, a binding, the exclusion link, flags. */
const everyEndpoint = async (): Promise<Config> =>
	(await analytics({
		adapters: [native()],
		capture: { gate: 'off', exclusion: true },
		collections: { pages: { pathField: 'slug' } },
	})({ collections: [] } as unknown as Config)) as Config

describe('the endpoints reference', () => {
	it('lists every route the plugin registers, with its method, under the default /api base', async () => {
		const config = await everyEndpoint()
		const routes = (config.endpoints ?? []).map((endpoint) => ({
			method: endpoint.method.toUpperCase(),
			path: `/api${endpoint.path}`,
		}))
		expect(routes.length).toBeGreaterThanOrEqual(16)
		const page = readFileSync(PAGE, 'utf8').split('\n')
		const missing = routes
			.filter(
				({ method, path }) =>
					!page.some((line) => line.includes(`\`${path}\``) && line.includes(`\`${method}\``))
			)
			.map(({ method, path }) => `${method} ${path}`)
		expect(missing, `reference/endpoints.mdx does not list: ${missing.join(', ')}`).toEqual([])
	})
})
