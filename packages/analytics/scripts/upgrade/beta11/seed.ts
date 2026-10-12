import { getPayload, handleEndpoints } from 'payload'
import config from './payload.config'

/**
 * What the beta.11 host leaves for the upgrade to meet, run with `payload run` from the same
 * checkout: three pageviews through its ingest endpoint, a provider document with a stored key and
 * a goal (on the `scoped` variant, each per tenant, written by a platform user), and a queued run
 * of each task the host registered that this release renamed, retired or kept.
 */

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const PLATFORM = { email: 'upgrade-platform@example.test', password: 'upgrade-test-password' }

const fail = (message: string): never => {
	console.error(`upgrade seed: ${message}`)
	process.exit(1)
}

// biome-ignore lint/plugin/noProcessEnv: upgrade test env boundary, as payload.config.ts
const variant = process.env.UPGRADE_VARIANT
const tenants = variant === 'scoped' ? ['alpha', 'beta'] : [null]

const payload = await getPayload({ config })
const platform =
	variant === 'scoped'
		? await payload.create({ collection: 'users', data: PLATFORM, overrideAccess: true })
		: undefined

for (const tenant of tenants) {
	const host = tenant ? `${tenant}.upgrade.test` : 'upgrade.test'
	for (let i = 0; i < 3; i++) {
		const res = await handleEndpoints({
			config,
			request: new Request(`http://${host}/api/analytics/ingest`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, host },
				body: JSON.stringify({ type: 'pageview', path: '/before-upgrade', hostname: host }),
			}),
		})
		if (res.status !== 202) {
			fail(`the beta.11 ingest endpoint answered ${res.status} for ${host}: ${await res.text()}`)
		}
	}
	const suffix = tenant ? ` ${tenant}` : ''
	await payload.create({
		collection: 'analytics-providers',
		data: {
			name: `Upgrade Plausible${suffix}`,
			provider: 'plausible',
			enabled: true,
			plausible: { siteId: host, apiKey: 'plausible-upgrade-key' },
			...(tenant ? { scope: tenant } : {}),
		},
		...(platform ? { user: { ...platform, collection: 'users' } } : {}),
	})
	await payload.create({
		collection: 'analytics-goals',
		data: {
			name: `Signup${suffix}`,
			slug: tenant ? `signup-${tenant}` : 'signup',
			enabled: true,
			match: { kind: 'event', name: 'signup' },
			...(tenant ? { scope: tenant } : {}),
		},
		...(platform ? { user: { ...platform, collection: 'users' } } : {}),
	})
}

const stored = await payload.count({ collection: 'analytics-events' })
if (stored.totalDocs < 3 * tenants.length) {
	fail(`beta.11 stored ${stored.totalDocs} events of ${3 * tenants.length}`)
}

const queued =
	variant === 'tasks'
		? ['analytics-prune-events', 'analytics-warm-cache', 'analytics-sync']
		: variant === 'sync'
			? ['analytics-sync']
			: []
for (const task of queued) {
	await payload.jobs.queue({ task, input: {} })
}

console.log(
	`upgrade seed (${variant}): beta.11 stored ${stored.totalDocs} events, ${tenants.length} provider(s), ${tenants.length} goal(s) and ${queued.length} queued run(s)`
)
await payload.destroy()
process.exit(0)
