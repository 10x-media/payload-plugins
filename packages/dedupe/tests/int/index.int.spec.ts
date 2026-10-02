import { describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyMerge } from '../../src/merge/apply'
import { resolveOptions } from '../../src/options'
import { buildContext, getCollectionContext, getContext } from '../../src/plugin/context'
import { decidePair, type PairRow } from '../../src/queue/pairs'
import { runScan } from '../../src/queue/scan'
import { bootDedupe, CUSTOMERS, type Doc, emitted } from './fixtures'

/** Boot, blocking keys, the live check on save and the full scan. */
describeForDb('dedupe index', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('keeps its context across a hot reload', () => {
		const { payload } = fixture.booted
		const before = getContext(payload)
		const original = payload.config
		// What Payload's `reload()` does on HMR: a fresh config, and no `onInit`.
		payload.config = { ...original, custom: { ...original.custom } }
		try {
			expect(getContext(payload)).toBe(before)
		} finally {
			payload.config = original
		}
	})

	it('lets a pair go stale once an edit makes its documents unlike, without waiting for a scan', async () => {
		const { booted, customer, pairsFor } = fixture
		const first = await customer({
			name: 'Edit Twin',
			email: 'edit.one@index.test',
			phone: '0663334455',
		})
		const second = await customer({
			name: 'Edit Twin',
			email: 'edit.two@index.test',
			phone: '0663334455',
		})
		expect((await pairsFor(first.id)).map((pair) => pair.status)).toEqual(['open'])
		await booted.payload.update({
			collection: CUSTOMERS,
			id: second.id,
			data: { name: 'Quite Someone Else', phone: '0991112233' } as never,
		})
		expect((await pairsFor(first.id)).map((pair) => pair.status)).toEqual(['stale'])
	})

	it('lets a pair go stale once one of its documents moves to another tenant', async () => {
		const { booted, customer, pairsFor } = fixture
		const first = await customer({
			name: 'Tenant Twin',
			email: 'tenant.one@index.test',
			phone: '0664445566',
			tenant: 'north',
		})
		const second = await customer({
			name: 'Tenant Twin',
			email: 'tenant.two@index.test',
			phone: '0664445566',
			tenant: 'north',
		})
		expect((await pairsFor(first.id)).map((pair) => pair.status)).toEqual(['open'])
		await booted.payload.update({
			collection: CUSTOMERS,
			id: second.id,
			data: { tenant: 'south' } as never,
		})
		expect((await pairsFor(first.id)).map((pair) => pair.status)).toEqual(['stale'])
	})

	it('announces a pair that opens again as found', async () => {
		const { booted, customer, pairsFor } = fixture
		const first = await customer({
			name: 'Back Twin',
			email: 'back.one@index.test',
			phone: '0661112233',
			tenant: 'north',
		})
		const second = await customer({
			name: 'Back Twin',
			email: 'back.two@index.test',
			phone: '0661112233',
			tenant: 'north',
		})
		await booted.payload.update({
			collection: CUSTOMERS,
			id: second.id,
			data: { tenant: 'south' } as never,
		})
		const [pair] = await pairsFor(first.id)
		expect(pair?.status).toBe('stale')
		const before = emitted.length
		await booted.payload.update({
			collection: CUSTOMERS,
			id: second.id,
			data: { tenant: 'north' } as never,
		})
		expect(emitted.slice(before)).toContainEqual(
			expect.objectContaining({ type: 'pair.found', pairId: String(pair?.id) })
		)
	})

	it('files a pair under the tenant its documents moved to together', async () => {
		const { booted, customer, pairsFor } = fixture
		const twins = [
			await customer({
				name: 'Moving Twin',
				email: 'move.one@index.test',
				phone: '0667778899',
				tenant: 'north',
			}),
			await customer({
				name: 'Moving Twin',
				email: 'move.two@index.test',
				phone: '0667778899',
				tenant: 'north',
			}),
		]
		for (const twin of twins) {
			await booted.payload.update({
				collection: CUSTOMERS,
				id: twin.id,
				data: { tenant: 'south' } as never,
			})
		}
		expect(
			(await pairsFor(twins[0]?.id as string)).map((pair) => [pair.status, pair.tenant])
		).toEqual([['open', 'south']])
	})

	it('builds its context on first use when Payload started without `onInit`, as `payload migrate` does', async () => {
		const { payload } = fixture.booted
		const key = Symbol.for('@10x-media/dedupe/context')
		const host = payload as unknown as Record<symbol, unknown>
		const before = host[key]
		delete host[key]
		try {
			const saved = await fixture.customer({
				name: 'Migrated Person',
				email: 'migrated@index.test',
			})
			expect(saved.id).toBeDefined()
			expect(getContext(payload).localeCodes).toEqual(['en', 'de'])
		} finally {
			host[key] = before
		}
	})

	it('trashes merged-in documents where the collection has a trash, and deletes them where not', () => {
		const { payload } = fixture.booted
		const key = Symbol.for('@10x-media/dedupe/context')
		const host = payload as unknown as Record<symbol, unknown>
		const before = host[key]
		try {
			const built = buildContext(
				payload,
				resolveOptions({ collections: { tickets: true, customers: true } }),
				getContext(payload).adapter
			)
			expect(built.collections.get('tickets')?.options.absorbed).toBe('delete')
			expect(built.collections.get('customers')?.options.absorbed).toBe('trash')
			expect(() =>
				buildContext(
					payload,
					resolveOptions({ collections: { tickets: { absorbed: 'trash' } } }),
					getContext(payload).adapter
				)
			).toThrow(/"tickets" has no trash/)
		} finally {
			host[key] = before
		}
	})

	it('refuses at boot a match field that holds rows, a group or rich text, which compare by nothing', () => {
		const { payload } = fixture.booted
		const key = Symbol.for('@10x-media/dedupe/context')
		const host = payload as unknown as Record<symbol, unknown>
		const before = host[key]
		const withMatch = (slug: string, path: string) =>
			resolveOptions({ collections: { [slug]: { match: { fields: [{ path, weight: 1 }] } } } })
		const build = (slug: string, path: string) => () =>
			buildContext(payload, withMatch(slug, path), getContext(payload).adapter)
		try {
			expect(build('accounts', 'phones')).toThrow(/"phones".*rows/)
			// Rich text is compared by the settings of its nodes, the same in any two documents.
			expect(build('pages', 'body')).toThrow(/"body".*rich text/)
			expect(build('tickets', 'externalRef')).toThrow(/"externalRef".*hidden from the API/)
			expect(build('tickets', 'vendor.code')).toThrow(/"vendor.code".*hidden from the API/)
			expect(build('customers', 'addresses.city')).toThrow(/"addresses.city".*inside rows/)
			expect(build('customers', 'nothing')).toThrow(/"nothing" does not exist/)
			expect(build('customers', 'createdAt')).toThrow(/"createdAt".*is not merged/)
		} finally {
			host[key] = before
		}
	})

	describe('index and live check', () => {
		let ivan: Doc
		let twin: Doc
		let olga: Doc

		beforeAll(async () => {
			const { customer } = fixture
			ivan = await customer({
				name: 'Ivan Petrenko',
				email: 'ivan@mail.com',
				phone: '+380 50 123 45 67',
				birthDate: '1998-04-12',
				tags: ['a'],
			})
			twin = await customer({
				name: 'Petrenko Ivan',
				email: 'i.petrenko@mail.com',
				phone: '0501234567',
				birthDate: '1998-04-12',
				tags: ['b'],
			})
			olga = await customer({
				name: 'Olga Koval',
				email: 'olga@mail.com',
				birthDate: '1998-04-12',
			})
		})

		it('writes blocking keys on save, including every locale of a localized field', async () => {
			const { booted, keysFor } = fixture
			await booted.payload.update({
				collection: CUSTOMERS,
				id: ivan.id,
				data: { name: 'Іван Петренко' } as never,
				locale: 'de' as never,
				depth: 0,
			})
			const keys = (await keysFor(ivan.id)).map((row) => row.key)
			expect(keys).toEqual(
				expect.arrayContaining([
					'email=ivan@mail.com',
					'name=ivan|petrenko',
					'name=~petr',
					'name=петренко|іван',
					'phone=501234567',
					'birthDate=1998-04-12',
					'birthDate=1998-12-04',
				])
			)
		})

		it('opens a pair for the look-alike and none for the stranger', async () => {
			const { pairsFor } = fixture
			const pairs = await pairsFor(ivan.id)
			expect(pairs).toHaveLength(1)
			const pair = pairs[0] as PairRow
			expect([pair.docA, pair.docB].sort()).toEqual([String(ivan.id), String(twin.id)].sort())
			expect(pair.status).toBe('open')
			expect(pair.score).toBeGreaterThan(0.35)
			expect(pair.signals).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: 'name', kind: 'match' }),
					expect.objectContaining({ path: 'phone', kind: 'match' }),
					expect.objectContaining({ path: 'email', kind: 'differ' }),
				])
			)
			expect(await pairsFor(olga.id)).toHaveLength(0)
		})

		it('keeps a dismissal through a full scan and reports the run', async () => {
			const { booted, req, pairsFor } = fixture
			const pair = (await pairsFor(ivan.id))[0] as PairRow
			await decidePair({
				req,
				ctx: getContext(booted.payload),
				pair,
				status: 'dismissed',
			})
			expect(emitted.at(-1)).toMatchObject({ type: 'pair.dismissed', pairId: String(pair.id) })

			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			const summary = await runScan({ req, ctx, col })
			expect(summary.indexed).toBeGreaterThanOrEqual(3)
			expect(summary.compared).toBeGreaterThanOrEqual(1)

			const after = (await pairsFor(ivan.id))[0] as PairRow
			expect(after.status).toBe('dismissed')
			expect(after.lastSeenAt).not.toBeNull()
		})

		it('refuses a second scan of the same collection while one runs', async () => {
			const { booted, req } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			const first = runScan({ req, ctx, col })
			await expect(runScan({ req, ctx, col })).rejects.toMatchObject({ status: 409 })
			await first
			// The lock is released with the run, so the next scan goes through.
			await expect(runScan({ req, ctx, col })).resolves.toMatchObject({ collection: 'customers' })
		})

		it('never pairs documents of different tenants and reports the pair it found', async () => {
			const { booted, req, customer, keysFor, pairsFor } = fixture
			const before = emitted.filter((event) => event.type === 'pair.found').length
			const left = await customer({
				name: 'Petro Sydorenko',
				phone: '+380 67 111 22 33',
				tenant: 'a',
			})
			const right = await customer({
				name: 'Petro Sydorenko',
				phone: '0671112233',
				tenant: 'b',
			})
			expect(await pairsFor(left.id)).toHaveLength(0)
			expect((await keysFor(left.id)).every((row) => row.key.startsWith('t:a|'))).toBe(true)

			const same = await customer({ name: 'Petro Sydorenko', phone: '0671112233', tenant: 'a' })
			const pairs = await pairsFor(same.id)
			expect(pairs).toHaveLength(1)
			expect(pairs[0]?.tenant).toBe('a')
			expect(emitted.filter((event) => event.type === 'pair.found').length).toBe(before + 1)

			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			await expect(
				applyMerge({ req, ctx, col, survivorId: left.id, absorbedIds: [right.id], choices: {} })
			).rejects.toMatchObject({ status: 400 })
		})

		it('removes keys and supersedes pairs when a document is trashed', async () => {
			const { booted, customer, keysFor, pairsFor } = fixture
			const extra = await customer({
				name: 'Ivan Petrenko',
				email: 'ivan2@mail.com',
				phone: '+380501234567',
			})
			expect(await keysFor(extra.id)).not.toHaveLength(0)
			expect(await pairsFor(extra.id)).not.toHaveLength(0)
			await booted.payload.update({
				collection: CUSTOMERS,
				id: extra.id,
				data: { deletedAt: new Date().toISOString() } as never,
				depth: 0,
				overrideAccess: true,
			})
			expect(await keysFor(extra.id)).toHaveLength(0)
			for (const pair of await pairsFor(extra.id)) expect(pair.status).toBe('superseded')
		})
	})
})
