import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { colorField, presetsFromDoc } from '../../src/exports/color'
import { fields } from '../../src/index'
import type { ColorPreset, FieldsResolverArgs } from '../../src/types'

const resolverSpy = vi.fn(
	async (_args: FieldsResolverArgs): Promise<ColorPreset[]> => [{ key: 'brand', value: '#0ea5e9' }]
)

const throwingResolver = vi.fn(async (_args: FieldsResolverArgs): Promise<ColorPreset[]> => {
	throw new Error('resolver exploded')
})

const primaryLabel = { de: 'Primär', en: 'Primary' }

const tenants: CollectionConfig = {
	slug: 'tenants',
	fields: [
		{ name: 'name', type: 'text', required: true },
		colorField({ name: 'primary', label: primaryLabel }),
		colorField({ name: 'accent' }),
		{
			name: 'brandColors',
			type: 'array',
			fields: [
				{ name: 'key', type: 'text', required: true },
				{ name: 'label', type: 'text' },
				colorField({ name: 'value', required: true }),
			],
		},
	],
}

type TenantDoc = {
	brandColors?: Array<{ key: string; label?: null | string; value: string }> | null
	name: string
}

const tenantPresets = async ({ req }: FieldsResolverArgs): Promise<ColorPreset[]> => {
	const result = await req.payload.find({ collection: 'tenants', depth: 0, limit: 25 })
	return result.docs.flatMap((doc) => {
		const tenant = doc as unknown as TenantDoc
		return [
			...presetsFromDoc({
				collection: 'tenants',
				doc: doc as unknown as Record<string, unknown>,
				fields: ['primary', 'accent'],
				keyPrefix: `${tenant.name}/`,
				req,
			}),
			...(tenant.brandColors ?? []).map((color) => ({
				key: `${tenant.name}/${color.key}`,
				label: color.label ?? color.key,
				value: color.value,
			})),
		]
	})
}

const swatches: CollectionConfig = {
	slug: 'swatches',
	fields: [
		colorField({ name: 'hex' }),
		colorField({ name: 'rgb', format: 'rgb' }),
		colorField({ name: 'hsl', format: 'hsl' }),
		colorField({ name: 'oklch', format: 'oklch' }),
		colorField({ name: 'opaque', alpha: false }),
		...colorField({
			linked: true,
			name: 'linkedStatic',
			presets: [{ key: 'brand', value: '#7c3aed' }, 'tomato'],
		}),
		...colorField({
			linked: { fallback: '#111111' },
			name: 'linkedFallback',
			presets: [{ key: 'brand', value: '#7c3aed' }],
		}),
		...colorField({ linked: true, name: 'linkedAsync', presets: resolverSpy }),
		...colorField({
			linked: { fallback: '#fa11ba' },
			name: 'linkedThrowing',
			presets: throwingResolver,
		}),
		...colorField({ linked: true, name: 'linkedBrand', presets: tenantPresets }),
	],
}

describeForDb('fields color', {}, (db) => {
	let booted: BootedPayload

	const create = (data: Record<string, unknown>) =>
		booted.payload.create({ collection: 'swatches', data })

	beforeAll(async () => {
		booted = await bootPayload({ collections: [swatches, tenants], db, plugin: fields({}) })
		await booted.payload.create({
			collection: 'tenants',
			data: {
				name: 'acme',
				accent: '#f59e0b',
				brandColors: [{ key: 'surface', label: 'Acme surface', value: '#f5f3ff' }],
				primary: '#7c3aed',
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('normalizes any parseable css input to the stored format', async () => {
		const doc = await create({
			hex: 'red',
			hsl: 'rgb(255 0 0)',
			oklch: '#ff0000',
			rgb: '#ff0000',
		})
		expect(doc.hex).toBe('#ff0000')
		expect(doc.rgb).toBe('rgb(255 0 0)')
		expect(doc.hsl).toBe('hsl(0 100% 50%)')
		expect(doc.oklch).toBe('oklch(0.628 0.2577 29.23)')
	})

	it('persists alpha and strips it when alpha is disabled', async () => {
		const doc = await create({ hex: '#ff000080', opaque: '#ff000080' })
		expect(doc.hex).toBe('#ff000080')
		expect(doc.opaque).toBe('#ff0000')
	})

	it('rejects unparseable values', async () => {
		await expect(create({ hex: 'not-a-color' })).rejects.toThrow()
	})

	it('linked mode stores the reference and populates the resolved virtual sibling', async () => {
		const doc = await create({ linkedStatic: 'preset:brand' })
		expect(doc.linkedStatic).toBe('preset:brand')
		expect(doc.linkedStaticResolved).toBe('#7c3aed')
		const fetched = await booted.payload.findByID({ collection: 'swatches', id: doc.id })
		// Round-trip safety: the stored reference survives reads; only the sibling resolves
		expect(fetched.linkedStatic).toBe('preset:brand')
		expect(fetched.linkedStaticResolved).toBe('#7c3aed')
		// At rest: the raw reference string is stored and the virtual sibling has no column/key
		const raw = await booted.payload.db.findOne<{ id: number | string } & Record<string, unknown>>({
			collection: 'swatches',
			where: { id: { equals: doc.id } },
		})
		expect(raw?.linkedStatic).toBe('preset:brand')
		expect(raw?.linkedStaticResolved).toBeUndefined()
	})

	it('linked mode passes plain css values through to the sibling', async () => {
		const doc = await create({ linkedStatic: '#123456' })
		expect(doc.linkedStatic).toBe('#123456')
		expect(doc.linkedStaticResolved).toBe('#123456')
	})

	it('resolves string presets by their css value as key', async () => {
		const doc = await create({ linkedStatic: 'preset:tomato' })
		expect(doc.linkedStaticResolved).toBe('tomato')
	})

	it('missing preset resolves to the configured fallback, or null without one', async () => {
		const withFallback = await create({ linkedFallback: 'preset:ghost' })
		expect(withFallback.linkedFallbackResolved).toBe('#111111')
		const withoutFallback = await create({ linkedStatic: 'preset:ghost' })
		expect(withoutFallback.linkedStaticResolved).toBeNull()
	})

	it('memoizes an async preset resolver per request across a multi-doc find', async () => {
		for (let i = 0; i < 5; i += 1) {
			await create({ linkedAsync: 'preset:brand' })
		}
		resolverSpy.mockClear()
		const found = await booted.payload.find({
			collection: 'swatches',
			limit: 100,
			where: { linkedAsync: { equals: 'preset:brand' } },
		})
		expect(found.docs.length).toBeGreaterThanOrEqual(5)
		for (const doc of found.docs) {
			expect(doc.linkedAsyncResolved).toBe('#0ea5e9')
		}
		expect(resolverSpy).toHaveBeenCalledTimes(1)
	})

	it('degrades to the fallback when a preset resolver throws', async () => {
		const doc = await create({ linkedThrowing: 'preset:brand' })
		expect(doc.linkedThrowing).toBe('preset:brand')
		expect(doc.linkedThrowingResolved).toBe('#fa11ba')
		const fetched = await booted.payload.findByID({ collection: 'swatches', id: doc.id })
		expect(fetched.linkedThrowing).toBe('preset:brand')
		expect(fetched.linkedThrowingResolved).toBe('#fa11ba')
		const found = await booted.payload.find({
			collection: 'swatches',
			where: { linkedThrowing: { equals: 'preset:brand' } },
		})
		expect(found.docs.length).toBeGreaterThanOrEqual(1)
		for (const item of found.docs) {
			expect(item.linkedThrowingResolved).toBe('#fa11ba')
		}
	})

	it('supports querying by preset reference', async () => {
		const found = await booted.payload.find({
			collection: 'swatches',
			where: { linkedStatic: { equals: 'preset:brand' } },
		})
		expect(found.docs.length).toBeGreaterThanOrEqual(1)
	})

	it('resolves a field-derived preset through the virtual sibling', async () => {
		const doc = await create({ linkedBrand: 'preset:acme/primary' })
		expect(doc.linkedBrand).toBe('preset:acme/primary')
		expect(doc.linkedBrandResolved).toBe('#7c3aed')
		const fetched = await booted.payload.findByID({ collection: 'swatches', id: doc.id })
		expect(fetched.linkedBrandResolved).toBe('#7c3aed')
	})

	it('serves field-derived and array-derived presets from one combined resolver', async () => {
		const fieldDerived = await create({ linkedBrand: 'preset:acme/accent' })
		expect(fieldDerived.linkedBrandResolved).toBe('#f59e0b')
		const arrayDerived = await create({ linkedBrand: 'preset:acme/surface' })
		expect(arrayDerived.linkedBrandResolved).toBe('#f5f3ff')
	})

	it('passes localized record labels through presetsFromDoc untouched', async () => {
		const req = await createLocalReq({}, booted.payload)
		const found = await booted.payload.find({
			collection: 'tenants',
			limit: 1,
			where: { name: { equals: 'acme' } },
		})
		const presets = presetsFromDoc({
			collection: 'tenants',
			doc: found.docs[0] as unknown as Record<string, unknown>,
			fields: ['primary', 'accent', 'ghost'],
			keyPrefix: 'acme/',
			req,
		})
		// Sanitized configs humanize missing labels (toWords), so accent -> 'Accent'
		expect(presets).toEqual([
			{ key: 'acme/primary', label: primaryLabel, value: '#7c3aed' },
			{ key: 'acme/accent', label: 'Accent', value: '#f59e0b' },
		])
	})
})
