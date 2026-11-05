import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { type GatedScope, SYSTEM } from '../access/principal'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { PLATFORM_SCOPE } from './contract'
import { allCrossScope } from './options'
import { createRegistry } from './registry'
import { resolveQueryScope, resolveReadContext, resolveRequestedScope } from './scopedRead'

const runtimeWith = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(),
	bindings: {},
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: { aggregate: 3600, realtime: 300 },
	comparison: true,
	readAccess: () => true,
	...overrides,
})

/** A source that narrows its query to one scope, which every tenant may read through. */
const scopedAdapter = () => {
	const adapter = memoryAdapter()
	return { ...adapter, capabilities: { ...adapter.capabilities, scopedQueries: true } }
}

const adminConfig = { config: { admin: { user: 'users' } } }
/** A fresh request each time: the read gate and membership are memoized on the request. */
const userReq = (): PayloadRequest =>
	({ payload: adminConfig, user: { id: 1, collection: 'users' } }) as unknown as PayloadRequest
const anonReq = (): PayloadRequest =>
	({ payload: adminConfig, user: null }) as unknown as PayloadRequest

const gatedFor = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	raw: string
): Promise<GatedScope> => {
	const requested = await resolveRequestedScope({ runtime, req, raw })
	if (!requested.ok) {
		throw new Error(`scope ${raw} was refused: ${requested.reason}`)
	}
	return requested.gated
}

describe('resolveReadContext', () => {
	it('resolves the default adapter with a null scope when no resolvers exist', async () => {
		const ctx = await resolveReadContext({ runtime: runtimeWith(), req: userReq() })
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.adapter.id).toBe('memory')
			expect(ctx.scope).toBeNull()
			expect(ctx.queryScope).toBeUndefined()
		}
	})

	it('resolves scope from the runtime scope resolver and stamps queryScope', async () => {
		const runtime = runtimeWith({ resolveScope: async () => 'tenant-a', member: () => true })
		const ctx = await resolveReadContext({ runtime, req: userReq() })
		expect(ctx.ok && ctx.scope).toBe('tenant-a')
		expect(ctx.ok && ctx.queryScope).toBe('tenant-a')
	})

	it('reads a cleared scope as given, and the system principal any scope it names', async () => {
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			member: () => true,
		})
		const req = userReq()
		const cleared = await resolveReadContext({
			runtime,
			req,
			scope: await gatedFor(runtime, req, 'tenant-b'),
		})
		expect(cleared.ok && cleared.scope).toBe('tenant-b')
		const system = await resolveReadContext({ runtime, req, principal: SYSTEM, scope: 'tenant-c' })
		expect(system.ok && system.scope).toBe('tenant-c')
		const installWide = await resolveReadContext({ runtime, req, principal: SYSTEM, scope: null })
		expect(installWide.ok && installWide.scope).toBeNull()
	})

	it('pins the scope it read for the reads made on its behalf', async () => {
		const runtime = runtimeWith({ resolveScope: async () => 'tenant-a', member: () => true })
		const own = await resolveReadContext({ runtime, req: userReq() })
		expect(own.ok && own.pin.scope !== undefined).toBe(true)
		expect(own.ok && own.pin.principal).toBeUndefined()
		const system = await resolveReadContext({
			runtime,
			req: anonReq(),
			principal: SYSTEM,
			scope: 'tenant-b',
		})
		expect(system.ok && system.pin).toEqual({ principal: SYSTEM, scope: 'tenant-b' })
	})

	it('passes the scope to the registry resolver', async () => {
		const scopes: Array<string | null> = []
		const registry = createRegistry([memoryAdapter()])
		const runtime = runtimeWith({
			resolveScope: async () => 't1',
			member: () => true,
			resolveRegistry: async ({ scope }) => {
				scopes.push(scope)
				return { registry, grants: new Map() }
			},
		})
		await resolveReadContext({ runtime, req: userReq() })
		expect(scopes).toEqual(['t1'])
	})

	it('degrades to not-ok for an unknown adapter id', async () => {
		const ctx = await resolveReadContext({
			runtime: runtimeWith(),
			req: userReq(),
			adapterId: 'nope',
		})
		expect(ctx.ok).toBe(false)
	})

	it('degrades to not-ok when the scope resolver throws', async () => {
		const runtime = runtimeWith({
			resolveScope: async () => {
				throw new Error('boom')
			},
		})
		const ctx = await resolveReadContext({ runtime, req: userReq() })
		expect(ctx.ok).toBe(false)
	})
})

describe('resolveReadContext access.read', () => {
	it('refuses a reader access.read denies, naming the reason', async () => {
		const runtime = runtimeWith({ readAccess: () => false })
		expect(await resolveReadContext({ runtime, req: userReq() })).toEqual({
			ok: false,
			reason: 'no-access',
		})
	})

	it('defaults to the admin collection when the runtime carries no access.read', async () => {
		const runtime = runtimeWith({ readAccess: undefined })
		expect((await resolveReadContext({ runtime, req: userReq() })).ok).toBe(true)
		const customer = {
			payload: adminConfig,
			user: { id: 2, collection: 'customers' },
		} as unknown as PayloadRequest
		expect(await resolveReadContext({ runtime, req: customer })).toEqual({
			ok: false,
			reason: 'no-access',
		})
	})

	it('asks access.read once per request however many reads ask', async () => {
		let asked = 0
		const runtime = runtimeWith({
			readAccess: () => {
				asked++
				return true
			},
		})
		const req = userReq()
		await resolveReadContext({ runtime, req })
		await resolveReadContext({ runtime, req })
		expect(asked).toBe(1)
	})

	it('lets the system principal read without asking access.read or membership', async () => {
		let asked = 0
		const runtime = runtimeWith({
			scoped: true,
			registry: createRegistry([scopedAdapter()]),
			readAccess: () => {
				asked++
				return false
			},
			member: () => {
				asked++
				return false
			},
		})
		const ctx = await resolveReadContext({
			runtime,
			req: anonReq(),
			principal: SYSTEM,
			scope: 'tenant-a',
		})
		expect(ctx.ok && ctx.scope).toBe('tenant-a')
		expect(asked).toBe(0)
	})
})

describe('resolveReadContext membership', () => {
	const tenant = (member: boolean): AnalyticsRuntime =>
		runtimeWith({
			scoped: true,
			registry: createRegistry([scopedAdapter()]),
			resolveScope: async () => 'alpha',
			member: () => member,
			crossScope: allCrossScope(() => false),
		})

	it("reads a member's own scope", async () => {
		const ctx = await resolveReadContext({ runtime: tenant(true), req: userReq() })
		expect(ctx.ok && ctx.scope).toBe('alpha')
	})

	it('refuses a scope the request selected but its user does not belong to', async () => {
		expect(await resolveReadContext({ runtime: tenant(false), req: userReq() })).toEqual({
			ok: false,
			reason: 'not-member',
		})
	})

	it('lets access.crossScope.named read a scope its user does not belong to', async () => {
		const runtime = runtimeWith({
			scoped: true,
			registry: createRegistry([scopedAdapter()]),
			resolveScope: async () => 'alpha',
			member: () => false,
			crossScope: { named: () => true, aggregate: () => false, unscopedSource: () => false },
		})
		const ctx = await resolveReadContext({ runtime, req: userReq() })
		expect(ctx.ok && ctx.scope).toBe('alpha')
	})
})

describe('resolveReadContext platform gating', () => {
	it("reads a cleared '*' install-wide and strips the query scope", async () => {
		const runtime = runtimeWith()
		const req = userReq()
		const allowed = await resolveReadContext({
			runtime,
			req,
			scope: await gatedFor(runtime, req, PLATFORM_SCOPE),
		})
		expect(allowed.ok).toBe(true)
		if (allowed.ok) {
			expect(allowed.scope).toBeNull()
			expect(allowed.queryScope).toBeUndefined()
		}
		const denied = await resolveRequestedScope({ runtime, req: anonReq(), raw: PLATFORM_SCOPE })
		expect(denied.ok).toBe(false)
	})

	it('honors a custom crossScope for cross-scope reads', async () => {
		const runtime = runtimeWith({ crossScope: allCrossScope(() => false) })
		const requested = await resolveRequestedScope({
			runtime,
			req: userReq(),
			raw: PLATFORM_SCOPE,
		})
		expect(requested.ok).toBe(false)
	})

	const namedOnly = (
		unscopedSource: (args: { req: PayloadRequest }) => boolean
	): Partial<AnalyticsRuntime> => ({
		scoped: true,
		crossScope: { named: () => true, aggregate: () => true, unscopedSource },
	})
	const signedIn = ({ req }: { req: PayloadRequest }) => Boolean(req.user)

	it('gates a scoped read through a shared config adapter that cannot filter by scope', async () => {
		const runtime = runtimeWith({ configAdapterIds: new Set(['memory']), ...namedOnly(signedIn) })
		const anon = anonReq()
		const denied = await resolveReadContext({
			runtime,
			req: anon,
			scope: await gatedFor(runtime, anon, 't1'),
		})
		expect(denied.ok).toBe(false)
		const user = userReq()
		const allowed = await resolveReadContext({
			runtime,
			req: user,
			scope: await gatedFor(runtime, user, 't1'),
		})
		expect(allowed.ok).toBe(true)
		if (allowed.ok) {
			expect(allowed.queryScope).toBeUndefined()
		}
	})

	it('gates the config adapter even when it is not the designated platform adapter', async () => {
		const runtime = runtimeWith({
			configAdapterIds: new Set(['memory']),
			platformAdapterId: 'other',
			...namedOnly(signedIn),
		})
		const anon = anonReq()
		const denied = await resolveReadContext({
			runtime,
			req: anon,
			scope: await gatedFor(runtime, anon, 't1'),
		})
		expect(denied.ok).toBe(false)
	})

	it('lets a scope-filtering (native) config adapter serve scoped reads ungated', async () => {
		const runtime = runtimeWith({
			registry: createRegistry([scopedAdapter()]),
			configAdapterIds: new Set(['memory']),
			platformAdapterId: 'memory',
			...namedOnly(() => false),
		})
		const req = anonReq()
		const ctx = await resolveReadContext({
			runtime,
			req,
			scope: await gatedFor(runtime, req, 't1'),
		})
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.queryScope).toBe('t1')
		}
	})

	it('leaves scoped reads through a runtime (non-config) adapter ungated', async () => {
		const runtime = runtimeWith({
			registry: createRegistry([scopedAdapter()]),
			configAdapterIds: new Set(),
			...namedOnly(() => false),
		})
		const req = anonReq()
		const ctx = await resolveReadContext({
			runtime,
			req,
			scope: await gatedFor(runtime, req, 't1'),
		})
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.queryScope).toBe('t1')
		}
	})

	it('leaves null-scope reads through the config adapter ungated', async () => {
		const runtime = runtimeWith({ configAdapterIds: new Set(['memory']) })
		const ctx = await resolveReadContext({ runtime, req: anonReq() })
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.queryScope).toBeUndefined()
		}
	})

	// A job warming or syncing one tenant must never store the platform's install-wide numbers
	// as that tenant's, so the system principal reads only what can answer for the tenant.
	it('keeps the system principal off a shared adapter that cannot narrow to a tenant', async () => {
		const runtime = runtimeWith({
			scoped: true,
			configAdapterIds: new Set(['memory']),
			crossScope: allCrossScope(() => true),
		})
		const tenant = await resolveReadContext({
			runtime,
			req: anonReq(),
			principal: SYSTEM,
			scope: 't1',
		})
		expect(tenant.ok).toBe(false)
		const all = await resolveReadContext({
			runtime,
			req: anonReq(),
			principal: SYSTEM,
			scope: PLATFORM_SCOPE,
		})
		expect(all.ok).toBe(true)
	})
})

describe('resolveReadContext scoped-install null-scope gating', () => {
	it('fails closed when a scoped install resolves no scope and crossScope denies', async () => {
		const runtime = runtimeWith({ scoped: true, crossScope: allCrossScope(() => false) })
		const ctx = await resolveReadContext({ runtime, req: userReq() })
		expect(ctx.ok).toBe(false)
	})

	it('stays ok when a scoped install resolves no scope but crossScope grants', async () => {
		const runtime = runtimeWith({ scoped: true, crossScope: allCrossScope(() => true) })
		const ctx = await resolveReadContext({ runtime, req: userReq() })
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.scope).toBeNull()
		}
	})

	it('lets the system principal read the install-wide scope regardless of crossScope', async () => {
		const runtime = runtimeWith({ scoped: true, crossScope: allCrossScope(() => false) })
		const ctx = await resolveReadContext({
			runtime,
			req: userReq(),
			principal: SYSTEM,
			scope: null,
		})
		expect(ctx.ok).toBe(true)
	})

	it('leaves an unscoped install ungated for a null resolution', async () => {
		const runtime = runtimeWith({ crossScope: allCrossScope(() => false) })
		const ctx = await resolveReadContext({ runtime, req: userReq() })
		expect(ctx.ok).toBe(true)
	})

	// The widgets path and the endpoints must refuse the same requests, so the two answers
	// are compared rather than each asserted on its own.
	it('agrees with resolveRequestedScope on a scoped install that resolves no scope', async () => {
		for (const grants of [false, true]) {
			const runtime = runtimeWith({ scoped: true, crossScope: allCrossScope(() => grants) })
			const requested = await resolveRequestedScope({ runtime, req: userReq() })
			const ctx = await resolveReadContext({ runtime, req: userReq() })
			expect(requested.ok).toBe(grants)
			expect(ctx.ok).toBe(requested.ok)
		}
	})
})

describe('resolveRequestedScope named scopes', () => {
	const tenantAdmin = (member = true) =>
		runtimeWith({
			scoped: true,
			resolveScope: async () => 'alpha',
			member: () => member,
			crossScope: allCrossScope(() => false),
		})

	// Every widget link carries the scope its read resolved to, so a tenant admin clicking
	// "Open in Analytics" names their own scope back at the endpoint.
	it('accepts the scope the request already resolves to, without crossScope', async () => {
		const requested = await resolveRequestedScope({
			runtime: tenantAdmin(),
			req: userReq(),
			raw: 'alpha',
		})

		expect(requested.ok && requested.scope).toBe('alpha')
		expect(requested.ok && requested.gated.value).toBe('alpha')
	})

	it('refuses the scope the request resolves to when its user does not belong to it', async () => {
		const named = await resolveRequestedScope({
			runtime: tenantAdmin(false),
			req: userReq(),
			raw: 'alpha',
		})
		const own = await resolveRequestedScope({ runtime: tenantAdmin(false), req: userReq() })

		expect(named).toEqual({ ok: false, reason: 'not-member' })
		expect(own).toEqual({ ok: false, reason: 'not-member' })
	})

	it("refuses another tenant's scope and the wildcard from the same reader", async () => {
		const other = await resolveRequestedScope({
			runtime: tenantAdmin(),
			req: userReq(),
			raw: 'beta',
		})
		const all = await resolveRequestedScope({
			runtime: tenantAdmin(),
			req: userReq(),
			raw: PLATFORM_SCOPE,
		})

		expect(other).toEqual({ ok: false, reason: 'named' })
		expect(all).toEqual({ ok: false, reason: 'named' })
	})

	it('refuses a named scope when the reader resolves the wildcard themselves', async () => {
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => PLATFORM_SCOPE,
			crossScope: allCrossScope(() => false),
		})
		const requested = await resolveRequestedScope({
			runtime,
			req: userReq(),
			raw: PLATFORM_SCOPE,
		})

		expect(requested).toEqual({ ok: false, reason: 'named' })
	})

	it('lets a platform reader name any scope, resolving nothing of its own', async () => {
		let resolutions = 0
		let memberships = 0
		const runtime = runtimeWith({
			scoped: true,
			crossScope: allCrossScope(() => true),
			member: () => {
				memberships++
				return false
			},
			resolveScope: async () => {
				resolutions++
				return 'alpha'
			},
		})
		const requested = await resolveRequestedScope({ runtime, req: userReq(), raw: 'beta' })

		expect(requested.ok && requested.scope).toBe('beta')
		expect(resolutions).toBe(0)
		expect(memberships).toBe(0)
	})

	it('refuses any name but the wildcard on an install without tenants, and an overlong one anywhere', async () => {
		const platform = { crossScope: allCrossScope(() => true) }
		const unscoped = runtimeWith(platform)
		expect(
			await resolveRequestedScope({ runtime: unscoped, req: userReq(), raw: 'made-up' })
		).toEqual({ ok: false, reason: 'named' })
		const all = await resolveRequestedScope({
			runtime: unscoped,
			req: userReq(),
			raw: PLATFORM_SCOPE,
		})
		expect(all.ok).toBe(true)
		const scoped = runtimeWith({ ...platform, scoped: true })
		expect(
			await resolveRequestedScope({ runtime: scoped, req: userReq(), raw: 'x'.repeat(257) })
		).toEqual({ ok: false, reason: 'named' })
	})

	it("reports a read naming another tenant's scope as no access, not as unavailable", async () => {
		const ctx = await resolveReadContext({ runtime: tenantAdmin(), req: userReq(), scope: 'beta' })
		expect(ctx).toEqual({ ok: false, reason: 'no-access' })
	})

	it('refuses a named scope when the resolver throws, rather than trusting it', async () => {
		const runtime = runtimeWith({
			scoped: true,
			crossScope: allCrossScope(() => false),
			resolveScope: async () => {
				throw new Error('boom')
			},
		})
		const requested = await resolveRequestedScope({ runtime, req: userReq(), raw: 'alpha' })

		expect(requested).toEqual({ ok: false, reason: 'named' })
	})

	it('asks membership once per request and scope', async () => {
		let asked = 0
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'alpha',
			crossScope: allCrossScope(() => false),
			member: () => {
				asked++
				return true
			},
		})
		const req = userReq()
		await resolveRequestedScope({ runtime, req })
		await resolveRequestedScope({ runtime, req, raw: 'alpha' })
		expect(asked).toBe(1)
	})
})

describe('resolveQueryScope', () => {
	const adapter = memoryAdapter()
	const scopedAdapter = {
		...adapter,
		capabilities: { ...adapter.capabilities, scopedQueries: true },
	}

	it('stamps nothing for an install-wide read', async () => {
		const decision = await resolveQueryScope({
			runtime: runtimeWith(),
			req: userReq(),
			scope: null,
			adapter,
		})
		expect(decision).toEqual({ ok: true })
	})

	it('gates the platform scope marker behind crossScope', async () => {
		const denied = await resolveQueryScope({
			runtime: runtimeWith({ crossScope: allCrossScope(() => false) }),
			req: userReq(),
			scope: PLATFORM_SCOPE,
			adapter,
		})
		expect(denied.ok).toBe(false)
		const granted = await resolveQueryScope({
			runtime: runtimeWith({ crossScope: allCrossScope(() => true) }),
			req: userReq(),
			scope: PLATFORM_SCOPE,
			adapter,
		})
		expect(granted).toEqual({ ok: true })
	})

	it('gates a scoped read through a shared config adapter that cannot filter by scope', async () => {
		const configAdapterIds = new Set(['memory'])
		const denied = await resolveQueryScope({
			runtime: runtimeWith({ configAdapterIds, crossScope: allCrossScope(() => false) }),
			req: userReq(),
			scope: 'tenant-a',
			adapter,
		})
		expect(denied.ok).toBe(false)
		const granted = await resolveQueryScope({
			runtime: runtimeWith({ configAdapterIds, crossScope: allCrossScope(() => true) }),
			req: userReq(),
			scope: 'tenant-a',
			adapter,
		})
		expect(granted).toEqual({ ok: true })
	})

	it('stamps the scope on an adapter that can narrow to it, config or runtime', async () => {
		const shared = await resolveQueryScope({
			runtime: runtimeWith({
				configAdapterIds: new Set(['memory']),
				crossScope: allCrossScope(() => false),
			}),
			req: userReq(),
			scope: 'tenant-a',
			adapter: scopedAdapter,
		})
		expect(shared).toEqual({ ok: true, queryScope: 'tenant-a' })
		const runtimeOwned = await resolveQueryScope({
			runtime: runtimeWith({ crossScope: allCrossScope(() => false) }),
			req: userReq(),
			scope: 'tenant-a',
			adapter,
		})
		expect(runtimeOwned).toEqual({ ok: true, queryScope: 'tenant-a' })
	})
})
