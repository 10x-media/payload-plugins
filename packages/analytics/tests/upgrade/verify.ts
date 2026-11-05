import { getPayload, handleEndpoints } from 'payload'
import config from './host.config'

/**
 * Run with `payload run` after scripts/upgrade.sh migrates the host: new beacons read back, beta.11
 * provider and goal documents served, retired runs and salts gone; `scoped` checks each tenant.
 */

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const HOST = 'upgrade.test'
const ADMIN = { email: 'upgrade-admin@example.test', password: 'upgrade-test-password' }
const RETIRED_TASKS = ['analytics-prune-events', 'analytics-warm-cache']
// biome-ignore lint/plugin/noProcessEnv: upgrade test env boundary, as host.config.ts
const variant = process.env.UPGRADE_VARIANT
const tenants = variant === 'scoped' ? ['alpha', 'beta'] : [null]

const failures: string[] = []
const check = (ok: boolean, message: string): void => {
	console.log(`upgrade verify: ${ok ? 'ok' : 'FAILED'} ${message}`)
	if (!ok) {
		failures.push(message)
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const call = async (path: string, init: RequestInit = {}): Promise<Response> =>
	handleEndpoints({ config, request: new Request(`http://${HOST}${path}`, init) })

const json = async (res: Response): Promise<Record<string, unknown>> => {
	const body: unknown = await res.json()
	return isRecord(body) ? body : {}
}

const payload = await getPayload({ config })
await payload.create({ collection: 'users', data: ADMIN })
const login = await json(
	await call('/api/users/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(ADMIN),
	})
)
const auth = { authorization: `JWT ${String(login.token)}` }

/** Three beacons through the host a tenant's visitors reach, or the install's own. */
const ingest = async (tenant: string | null): Promise<void> => {
	const host = tenant ? `${tenant}.${HOST}` : HOST
	for (let i = 0; i < 3; i++) {
		const res = await call('/api/_x/e', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, host },
			body: JSON.stringify({ type: 'pageview', path: '/after-upgrade' }),
		})
		check(res.status === 202, `ingest answered ${res.status} for ${host}`)
	}
}

/** The admin's headers, selecting a tenant the way the host's `admin` call site reads it. */
const as = (tenant: string | null): Record<string, string> =>
	tenant ? { ...auth, 'x-upgrade-tenant': tenant } : auth

const pageviews = async (tenant: string | null, path: string): Promise<unknown> => {
	const query = new URLSearchParams({
		source: 'native',
		metrics: 'pageviews',
		granularity: 'hour',
		from: new Date(Date.now() - 3_600_000).toISOString(),
		to: new Date(Date.now() + 3_600_000).toISOString(),
		path,
	})
	const body = await json(await call(`/api/_x/query?${query.toString()}`, { headers: as(tenant) }))
	const result = isRecord(body.result) ? body.result : {}
	const totals = isRecord(result.totals) ? result.totals : {}
	return totals.pageviews ?? JSON.stringify(body)
}

for (const tenant of tenants) {
	const named = tenant ? ` of ${tenant}` : ''
	const suffix = tenant ? ` ${tenant}` : ''
	await ingest(tenant)
	check(
		(await pageviews(tenant, '/after-upgrade')) === 3,
		`the query endpoint reads the 3 new pageviews${named}`
	)
	// The old storage is not converted: reports restart from the upgrade.
	check(
		(await pageviews(tenant, '/before-upgrade')) === 0,
		`the beta.11 events${named} are not read`
	)

	const sources = await json(await call('/api/_x/sources', { headers: as(tenant) }))
	const labels = Array.isArray(sources.sources)
		? sources.sources.flatMap((source) =>
				isRecord(source) && typeof source.label === 'string' ? [source.label] : []
			)
		: []
	check(
		labels.includes(`Upgrade Plausible${suffix}`),
		`the beta.11 provider document${named} is a source (${labels.join(', ')})`
	)

	const goals = await json(await call('/api/_x/goals', { headers: as(tenant) }))
	const slugs = Array.isArray(goals.goals)
		? goals.goals.flatMap((goal) =>
				isRecord(goal) && typeof goal.slug === 'string' ? [goal.slug] : []
			)
		: []
	const slug = tenant ? `signup-${tenant}` : 'signup'
	check(slugs.includes(slug), `the beta.11 goal document${named} is served (${slugs.join(', ')})`)
}

if (variant === 'scoped') {
	// A tenant the migration gave no `native` document: its beacons answer 202 and are dropped.
	await ingest('gamma')
	const kept = await payload.count({
		collection: 'analytics-hits',
		where: { scope: { equals: 'gamma' } },
		overrideAccess: true,
	})
	check(
		kept.totalDocs === 0,
		`a tenant without a native document stores nothing (${kept.totalDocs})`
	)
}

// Read whole rather than filtered: Postgres keeps task slugs in an enum, which the upgrade
// recreated without the retired ones, so a filter naming them is not even a valid query there.
const jobs = await payload.find({ collection: 'payload-jobs', pagination: false, depth: 0 })
const retired = jobs.docs.filter(
	(job) => typeof job.taskSlug === 'string' && RETIRED_TASKS.includes(job.taskSlug)
)
check(retired.length === 0, `no queued run of a retired task is left (${retired.length})`)

const salts = (await payload.kv.keys()).filter((key) => key.startsWith('analytics:salt:'))
check(salts.length === 0, `no beta.11 salt is left in the key-value store (${salts.length})`)

await payload.destroy()
if (failures.length > 0) {
	console.error(`upgrade verify: ${failures.length} check(s) failed`)
	process.exit(1)
}
console.log('upgrade verify: the upgraded host ingests, reads and keeps its documents')
process.exit(0)
