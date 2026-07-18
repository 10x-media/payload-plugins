import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { lucideAdapter } from '../../src/fields/icon/adapters/lucide/adapter'
import { radixAdapter } from '../../src/fields/icon/adapters/radix/adapter'
import { resolveAvailableLibraries } from '../../src/fields/icon/server/availability'
import { iconField } from '../../src/fields/icon/server/iconField'
import { iconLibraryField } from '../../src/fields/icon/server/iconLibraryField'
import { getIconLibraryOptions } from '../../src/fields/icon/server/libraryOptions'
import { fields } from '../../src/index'
import type { IconAvailabilityResolver } from '../../src/types'

describeForDb('icon field', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [
				{
					slug: 'icons',
					fields: [
						iconField(),
						iconField({ name: 'restricted', defaultLibrary: 'radix' }),
						iconLibraryField({ hasMany: true, name: 'libraries' }),
					],
				},
				{
					slug: 'tenants',
					fields: [
						{ name: 'name', type: 'text' },
						iconLibraryField({ hasMany: true, name: 'enabledLibraries' }),
					],
				},
			],
			db,
			plugin: fields({
				icon: { adapters: [lucideAdapter(), radixAdapter()], defaultLibrary: 'lucide' },
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('persists a prefixed value and reads it back unchanged', async () => {
		const doc = await booted.payload.create({
			collection: 'icons',
			data: { icon: 'lucide:house' },
		})
		expect(doc.icon).toBe('lucide:house')
		const read = await booted.payload.findByID({ collection: 'icons', id: doc.id })
		expect(read.icon).toBe('lucide:house')
	})

	it('accepts bare legacy values against the default library and stores them bare', async () => {
		const doc = await booted.payload.create({ collection: 'icons', data: { icon: 'heart' } })
		expect(doc.icon).toBe('heart')
	})

	it('rejects an unregistered library', async () => {
		await expect(
			booted.payload.create({ collection: 'icons', data: { icon: 'bogus:house' } })
		).rejects.toThrow()
	})

	it('rejects an unknown icon name in a known library (real committed manifest)', async () => {
		await expect(
			booted.payload.create({
				collection: 'icons',
				data: { icon: 'lucide:definitely-not-an-icon' },
			})
		).rejects.toThrow()
	})

	it('keeps an unknown stored name saveable when unchanged, but rejects changing it (deviation 11)', async () => {
		const seeded = await booted.payload.create({
			collection: 'icons',
			data: { icon: 'lucide:house' },
		})
		// Raw-mutate the stored value to a name the committed manifest lacks, emulating an
		// icon-set upgrade that dropped a glyph out from under already-stored data. Bypasses
		// create-time validation, which the previous test proves rejects unknown names.
		await booted.payload.db.updateOne({
			collection: 'icons',
			data: { icon: 'lucide:dropped-in-upgrade' },
			id: seeded.id,
		})
		// Re-saving the unchanged value succeeds only if the real update pipeline threads the
		// stored value through as previousValue, which is the load-bearing assumption of the leniency.
		const unchanged = await booted.payload.update({
			collection: 'icons',
			data: { icon: 'lucide:dropped-in-upgrade' },
			id: seeded.id,
		})
		expect(unchanged.icon).toBe('lucide:dropped-in-upgrade')
		await expect(
			booted.payload.update({
				collection: 'icons',
				data: { icon: 'lucide:still-not-a-real-icon' },
				id: seeded.id,
			})
		).rejects.toThrow()
	})

	it('respects a per-field defaultLibrary for bare values', async () => {
		await expect(
			booted.payload.create({
				collection: 'icons',
				data: { restricted: 'house' },
			})
		).rejects.toThrow()
		const doc = await booted.payload.create({
			collection: 'icons',
			data: { restricted: 'cube' },
		})
		expect(doc.restricted).toBe('cube')
	})

	it('iconLibraryField stores registered slugs and rejects unknown ones', async () => {
		const doc = await booted.payload.create({
			collection: 'icons',
			data: { libraries: ['lucide', 'radix'] },
		})
		expect(doc.libraries).toEqual(['lucide', 'radix'])
		await expect(
			booted.payload.create({ collection: 'icons', data: { libraries: ['tabler'] } })
		).rejects.toThrow()
	})

	it('derives library options from the plugin registry', () => {
		expect(getIconLibraryOptions(booted.payload.config).map((option) => option.value)).toEqual([
			'lucide',
			'radix',
		])
	})

	it('is queryable by exact value', async () => {
		await booted.payload.create({ collection: 'icons', data: { icon: 'lucide:anchor' } })
		const result = await booted.payload.find({
			collection: 'icons',
			where: { icon: { equals: 'lucide:anchor' } },
		})
		expect(result.totalDocs).toBe(1)
	})

	it('resolveAvailableLibraries filters to resolver output and memoizes per request', async () => {
		const registry = booted.payload.config.custom?.['@10x-media/fields'] as {
			icon?: { adapters?: ReturnType<typeof lucideAdapter>[] }
		}
		const adapters = registry.icon?.adapters ?? []
		expect(adapters.length).toBe(2)
		const resolver = vi.fn(async () => ['radix', 'not-registered'])
		const req = { payload: booted.payload } as PayloadRequest
		const first = await resolveAvailableLibraries({ adapters, req, resolver })
		const second = await resolveAvailableLibraries({ adapters, req, resolver })
		expect(first).toEqual(['radix'])
		expect(second).toEqual(['radix'])
		expect(resolver).toHaveBeenCalledTimes(1)
		const otherReq = { payload: booted.payload } as PayloadRequest
		await resolveAvailableLibraries({ adapters, req: otherReq, resolver })
		expect(resolver).toHaveBeenCalledTimes(2)
	})

	it('without a resolver every registered adapter is available', async () => {
		const registry = booted.payload.config.custom?.['@10x-media/fields'] as {
			icon?: { adapters?: ReturnType<typeof lucideAdapter>[] }
		}
		const req = { payload: booted.payload } as PayloadRequest
		expect(
			await resolveAvailableLibraries({ adapters: registry.icon?.adapters ?? [], req })
		).toEqual(['lucide', 'radix'])
	})

	it('unions a forced library with a resolver that reads a tenant', async () => {
		const registry = booted.payload.config.custom?.['@10x-media/fields'] as {
			icon?: { adapters?: ReturnType<typeof lucideAdapter>[] }
		}
		const adapters = registry.icon?.adapters ?? []
		// The tenant enables only lucide; radix is forced through alwaysAvailable, so the
		// resolved set is the tenant's library plus the forced one, in registration order.
		const tenant = await booted.payload.create({
			collection: 'tenants',
			data: { enabledLibraries: ['lucide'], name: 'acme' },
		})
		const resolver: IconAvailabilityResolver = async ({ req: resolverReq }) => {
			const doc = await resolverReq.payload.findByID({ collection: 'tenants', id: tenant.id })
			return Array.isArray(doc.enabledLibraries) ? (doc.enabledLibraries as string[]) : []
		}
		const req = { payload: booted.payload } as PayloadRequest
		const available = await resolveAvailableLibraries({
			adapters,
			alwaysAvailable: ['radix'],
			req,
			resolver,
		})
		expect(available).toEqual(['lucide', 'radix'])
	})
})
