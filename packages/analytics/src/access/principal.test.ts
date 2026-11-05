import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../core/registry'
import { resolveReadContext, resolveRequestedScope } from '../core/scopedRead'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import {
	type GatedScope,
	isGatedScope,
	type ReadPrincipal,
	readPrincipalOf,
	SYSTEM,
} from './principal'

const SRC = fileURLToPath(new URL('..', import.meta.url))

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return sourceFiles(path)
		}
		return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
	})

const runtime: AnalyticsRuntime = {
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(),
	bindings: {},
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	scoped: true,
	resolveScope: async () => 'alpha',
	member: () => true,
	crossScope: { named: () => false, aggregate: () => false, unscopedSource: () => false },
}

const req = { payload: {}, user: { id: 1 } } as unknown as PayloadRequest

describe('SYSTEM', () => {
	it('is one symbol, shared by every copy of the bundle', () => {
		expect(typeof SYSTEM).toBe('symbol')
		expect(Symbol.for('@10x-media/analytics/system')).toBe(SYSTEM)
	})

	// Whatever a caller sends travels as a string: a query parameter, a JSON body, a header.
	it('cannot arrive in request data', () => {
		const body: unknown = JSON.parse('{"principal":"@10x-media/analytics/system","scope":"beta"}')
		const params = new URLSearchParams('principal=Symbol(@10x-media/analytics/system)')
		const headers = new Headers({ principal: '@10x-media/analytics/system' })
		const fields = typeof body === 'object' && body !== null ? Object.values(body) : []
		expect(fields).toHaveLength(2)
		expect(fields).not.toContain(SYSTEM)
		expect([...params.values()]).not.toContain(SYSTEM)
		expect([...headers.values()]).not.toContain(SYSTEM)
	})
})

describe('GatedScope', () => {
	it('is what resolveRequestedScope hands back for a scope it cleared', async () => {
		const requested = await resolveRequestedScope({ runtime, req })
		expect(requested.ok && requested.gated.value).toBe('alpha')
	})

	it('is never minted for a scope it refused', async () => {
		const requested = await resolveRequestedScope({ runtime, req, raw: 'beta' })
		expect(requested).toEqual({ ok: false, reason: 'named' })
	})

	it('is recognized by its brand alone, so a copy minted by another bundle passes', () => {
		const shared = { [Symbol.for('@10x-media/analytics/gated-scope')]: true, value: 'beta' }
		expect(isGatedScope(shared)).toBe(true)
		expect(isGatedScope({ value: 'beta' })).toBe(false)
		expect(isGatedScope('beta')).toBe(false)
		expect(isGatedScope(null)).toBe(false)
	})

	it('is minted by resolveRequestedScope alone', () => {
		const minters = sourceFiles(SRC)
			.filter((file) => !file.endsWith(join('access', 'principal.ts')))
			.filter((file) => readFileSync(file, 'utf8').includes('mintGatedScope'))
			.map((file) => relative(SRC, file))
		expect(minters).toEqual([join('core', 'scopedRead.ts')])
	})
})

describe('readPrincipalOf', () => {
	it('keeps a system read on its own scope', () => {
		expect(readPrincipalOf({ principal: SYSTEM, scope: 'beta' })).toEqual({
			principal: SYSTEM,
			scope: 'beta',
		})
		expect(readPrincipalOf({ principal: SYSTEM, scope: null })).toEqual({
			principal: SYSTEM,
			scope: null,
		})
	})

	it("hands a request's cleared scope on, and nothing for its own", async () => {
		const requested = await resolveRequestedScope({ runtime, req })
		if (!requested.ok) {
			throw new Error('alpha was refused')
		}
		const pinned: ReadPrincipal = { scope: requested.gated }
		expect(readPrincipalOf(pinned)).toEqual({ scope: requested.gated })
		expect(readPrincipalOf({})).toEqual({})
	})

	it('drops whatever else the arguments carry', () => {
		const args = { principal: SYSTEM, scope: 'beta', adapterId: 'native' } as const
		expect(readPrincipalOf(args)).toEqual({ principal: SYSTEM, scope: 'beta' })
	})
})

describe('a read naming its scope', () => {
	const source = memoryAdapter()
	const scopedSource = { ...source, capabilities: { ...source.capabilities, scopedQueries: true } }

	/** Alpha's member asking, with the cross-scope gates `grants` opens and no other. */
	const reader = (
		grants: { aggregate?: boolean; named?: boolean; member?: boolean } = {}
	): { runtime: AnalyticsRuntime; req: PayloadRequest } => ({
		runtime: {
			...runtime,
			registry: createRegistry([scopedSource]),
			readAccess: () => true,
			member: () => grants.member ?? true,
			crossScope: {
				named: () => grants.named ?? false,
				aggregate: () => grants.aggregate ?? false,
				unscopedSource: () => false,
			},
		},
		req: {
			payload: { logger: { warn: () => undefined } },
			user: { id: 1 },
		} as unknown as PayloadRequest,
	})

	it("asks for every scope with '*', which the aggregate gate alone grants", async () => {
		await expect(resolveReadContext({ ...reader(), scope: '*' })).resolves.toEqual({
			ok: false,
			reason: 'no-access',
		})
		const granted = await resolveReadContext({ ...reader({ aggregate: true }), scope: '*' })
		expect(granted).toMatchObject({ ok: true, scope: null })
		expect(granted.ok && isGatedScope(granted.pin.scope) && granted.pin.scope.value).toBe('*')
	})

	it('refuses an object posing as a cleared scope, even one naming its own tenant', async () => {
		const forged = { value: 'alpha' } as unknown as GatedScope
		await expect(resolveReadContext({ ...reader(), scope: forged })).resolves.toEqual({
			ok: false,
		})
		const system = { principal: SYSTEM, scope: forged as unknown as string } as const
		await expect(resolveReadContext({ ...reader(), ...system })).resolves.toEqual({ ok: false })
	})

	it("reads a member's own tenant by name, and refuses it to a reader who is not one", async () => {
		await expect(resolveReadContext({ ...reader(), scope: 'alpha' })).resolves.toMatchObject({
			ok: true,
			scope: 'alpha',
			queryScope: 'alpha',
		})
		await expect(
			resolveReadContext({ ...reader({ member: false }), scope: 'alpha' })
		).resolves.toEqual({ ok: false, reason: 'not-member' })
	})

	it('refuses another tenant by name unless the named gate grants it', async () => {
		await expect(resolveReadContext({ ...reader(), scope: 'beta' })).resolves.toEqual({
			ok: false,
			reason: 'no-access',
		})
		await expect(
			resolveReadContext({ ...reader({ named: true }), scope: 'beta' })
		).resolves.toMatchObject({ ok: true, scope: 'beta' })
	})

	it("reads the request's own scope for null, as for no scope at all", async () => {
		await expect(resolveReadContext({ ...reader(), scope: null })).resolves.toMatchObject({
			ok: true,
			scope: 'alpha',
		})
	})
})
