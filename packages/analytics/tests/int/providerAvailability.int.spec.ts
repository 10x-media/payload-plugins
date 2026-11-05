import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolveSlotAdapterFor } from '../../src/capture/slots'
import { analytics } from '../../src/index'
import { type AnalyticsRuntime, getRuntime, resolveRegistryFor } from '../../src/plugin/runtime'
import { makeSourcesHandler } from '../../src/plugin/sourcesEndpoint'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const accessUsers: CollectionConfig = {
	slug: 'access-users',
	auth: true,
	fields: [{ name: 'role', type: 'text' }],
}

type User = { email?: string; role?: string } | null

const SCOPE_BY_EMAIL: Record<string, string | null> = {
	'editor-a@t.dev': 'tenant-a',
	'admin-a@t.dev': 'tenant-a',
	'b@t.dev': 'tenant-b',
	'root@t.dev': null,
}

const ROOT = 'root@t.dev'

const scope = {
	member: () => true,
	resolve: ({ req }: { req: PayloadRequest }) =>
		SCOPE_BY_EMAIL[(req.user as User)?.email ?? ''] ?? null,
}

const isRoot = ({ req }: { req: PayloadRequest }) => (req.user as User)?.email === ROOT

const login = async (payload: Payload, email: string, role = 'editor') => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'access-users', data: { email, password, role } as never })
	const result = await payload.login({ collection: 'access-users', data: { email, password } })
	return result.user
}

const runtimeOf = (payload: Payload): AnalyticsRuntime => {
	const runtime = getRuntime(payload)
	if (!runtime) throw new Error('runtime missing')
	return runtime
}

type ProviderRow = { id: string | number; isDefault?: boolean | null }

const plausibleDoc = (name: string, apiKey: string, extra: Record<string, unknown> = {}) => ({
	name,
	provider: 'plausible',
	enabled: true,
	plausible: { siteId: 'example.com', apiKey, domain: 'example.com' },
	...extra,
})

describeForDb('analytics provider documents: only available ones are sources', {}, (db) => {
	let booted: BootedPayload
	let missing: ProviderRow
	let complete: ProviderRow
	let userA: Awaited<ReturnType<typeof login>>
	let userB: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				capture: { gate: 'off' },
				scope,
				access: { crossScope: isRoot },
				providers: { collection: true },
			}),
		})
		userA = await login(booted.payload, 'editor-a@t.dev')
		userB = await login(booted.payload, 'b@t.dev')
		missing = (await booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: plausibleDoc('No key yet', '') as never,
			user: userA,
			overrideAccess: false,
		})) as unknown as ProviderRow
		complete = (await booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: plausibleDoc('Keyed', 'plausible-key') as never,
			user: userB,
			overrideAccess: false,
		})) as unknown as ProviderRow
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const sourcesOf = async (user: unknown): Promise<string[]> => {
		const res = await makeSourcesHandler()({
			user,
			payload: booted.payload,
		} as unknown as PayloadRequest)
		expect(res.status).toBe(200)
		return ((await res.json()) as { sources: Array<{ id: string }> }).sources.map((s) => s.id)
	}

	it('leaves a document missing a credential out of the sources listing', async () => {
		expect(await sourcesOf(userA)).not.toContain(`plausible:${missing.id}`)
		expect(await sourcesOf(userB)).toEqual([`plausible:${complete.id}`])
	})

	it('grants nothing through it, in the registry and to the beacon check alike', async () => {
		const runtime = runtimeOf(booted.payload)
		const { grants } = await resolveRegistryFor(runtime, {
			payload: booted.payload,
			scope: 'tenant-a',
		})
		expect(grants.size).toBe(0)
		expect(await runtime.providerGranted?.('tenant-a', `plausible:${missing.id}`)).toBe(false)
		expect(await runtime.providerGranted?.('tenant-b', `plausible:${complete.id}`)).toBe(true)
	})

	it('fills no tenant capture slot, while a complete document does', async () => {
		const runtime = runtimeOf(booted.payload)
		const slotFor = (tenant: string) =>
			resolveSlotAdapterFor({
				runtime,
				req: { payload: booted.payload, headers: new Headers() } as unknown as PayloadRequest,
				slot: 'tenant',
				scope: tenant,
			})
		expect(await slotFor('tenant-a')).toBeNull()
		expect((await slotFor('tenant-b'))?.id).toBe(`plausible:${complete.id}`)
	})

	it('offers no native type without native(), and refuses a save of one by name', async () => {
		const field = booted.payload.collections[PROVIDERS_SLUG as never]?.config.fields.find(
			(f) => 'name' in f && f.name === 'provider'
		)
		const offered =
			field?.type === 'select'
				? (
						field.filterOptions?.({
							data: {},
							options: field.options,
							req: {} as never,
							siblingData: {},
						}) ?? field.options
					).map((o) => (typeof o === 'string' ? o : o.value))
				: []
		expect(offered).toEqual(['plausible', 'umami', 'ga4', 'posthog'])
		await expect(
			booted.payload.create({
				collection: PROVIDERS_SLUG as never,
				data: { name: 'Payload', provider: 'native', enabled: true } as never,
				user: userA,
				overrideAccess: false,
			})
		).rejects.toMatchObject({
			data: { errors: [{ path: 'provider', message: expect.stringContaining('cannot use') }] },
		})
	})
})

describeForDb('analytics provider documents: default for this site', {}, (db) => {
	let booted: BootedPayload
	let editorA: Awaited<ReturnType<typeof login>>
	let adminA: Awaited<ReturnType<typeof login>>
	let root: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				capture: { gate: 'off' },
				scope,
				access: { crossScope: isRoot },
				providers: {
					collection: {
						defaultAccess: ({ req }) => isRoot({ req }) || (req.user as User)?.role === 'admin',
					},
				},
			}),
		})
		editorA = await login(booted.payload, 'editor-a@t.dev')
		adminA = await login(booted.payload, 'admin-a@t.dev', 'admin')
		root = await login(booted.payload, ROOT)
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const create = (data: Record<string, unknown>, user: unknown) =>
		booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: data as never,
			user,
			overrideAccess: false,
		}) as unknown as Promise<ProviderRow>

	const update = (id: ProviderRow['id'], data: Record<string, unknown>, user: unknown) =>
		booted.payload.update({
			collection: PROVIDERS_SLUG as never,
			id,
			data: data as never,
			user,
			overrideAccess: false,
		}) as unknown as Promise<ProviderRow>

	const removeAll = () =>
		booted.payload.delete({
			collection: PROVIDERS_SLUG as never,
			where: { id: { exists: true } },
			overrideAccess: true,
		})

	it('lets an admin-level user set it and drops it from an editor-level one', async () => {
		try {
			const byEditor = await create(plausibleDoc('Editor', 'k1', { isDefault: true }), editorA)
			expect(byEditor.isDefault).toBe(false)
			expect((await update(byEditor.id, { isDefault: true }, editorA)).isDefault).toBe(false)
			expect((await update(byEditor.id, { isDefault: true }, adminA)).isDefault).toBe(true)
			expect((await update(byEditor.id, { isDefault: false }, editorA)).isDefault).toBe(true)
		} finally {
			await removeAll()
		}
	})

	it('refuses a second flagged document in the same scope, but not in another', async () => {
		try {
			await create(plausibleDoc('First', 'k1', { isDefault: true }), adminA)
			await expect(
				create(plausibleDoc('Second', 'k2', { isDefault: true }), adminA)
			).rejects.toMatchObject({
				data: { errors: [expect.objectContaining({ path: 'isDefault' })] },
			})
			const unflagged = await create(plausibleDoc('Third', 'k3'), adminA)
			await expect(update(unflagged.id, { isDefault: true }, adminA)).rejects.toThrow()
			const other = await create(
				plausibleDoc('Tenant B', 'k4', { isDefault: true, scope: 'tenant-b' }),
				root
			)
			expect(other.isDefault).toBe(true)
		} finally {
			await removeAll()
		}
	})

	it("fills the scope registry's default grant from the flagged document", async () => {
		try {
			await create(plausibleDoc('Plain', 'k1'), adminA)
			const flagged = await create(plausibleDoc('Main', 'k2', { isDefault: true }), adminA)
			const resolved = await resolveRegistryFor(runtimeOf(booted.payload), {
				payload: booted.payload,
				scope: 'tenant-a',
			})
			expect(resolved.defaultGrant).toBe(`plausible:${flagged.id}`)
		} finally {
			await removeAll()
		}
	})
})

describeForDb('analytics provider documents: default access when unset', {}, (db) => {
	let booted: BootedPayload
	let member: Awaited<ReturnType<typeof login>>
	let root: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				capture: { gate: 'off' },
				scope,
				access: { crossScope: isRoot },
				providers: { collection: true },
			}),
		})
		member = await login(booted.payload, 'admin-a@t.dev', 'admin')
		root = await login(booted.payload, ROOT)
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	// The rule connectionAccess has: whoever creates the document, then the named cross-scope gate.
	it('lets the creator set it, then only the named cross-scope gate change it', async () => {
		const doc = (await booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: plausibleDoc('Mine', 'k1', { isDefault: true }) as never,
			user: member,
			overrideAccess: false,
		})) as unknown as ProviderRow
		expect(doc.isDefault).toBe(true)
		const change = (isDefault: boolean, user: unknown) =>
			booted.payload.update({
				collection: PROVIDERS_SLUG as never,
				id: doc.id,
				data: { isDefault } as never,
				user,
				overrideAccess: false,
			}) as unknown as Promise<ProviderRow>
		expect((await change(false, member)).isDefault).toBe(true)
		expect((await change(false, root)).isDefault).toBe(false)
	})
})
