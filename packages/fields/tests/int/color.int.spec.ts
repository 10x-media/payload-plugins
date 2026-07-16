import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { colorField } from '../../src/exports/color'
import { fields } from '../../src/index'
import type { ColorPreset, FieldsResolverArgs } from '../../src/types'

const resolverSpy = vi.fn(
	async (_args: FieldsResolverArgs): Promise<ColorPreset[]> => [{ key: 'brand', value: '#0ea5e9' }]
)

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
	],
}

describeForDb('fields color', {}, (db) => {
	let booted: BootedPayload

	const create = (data: Record<string, unknown>) =>
		booted.payload.create({ collection: 'swatches', data })

	beforeAll(async () => {
		booted = await bootPayload({ collections: [swatches], db, plugin: fields({}) })
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

	it('supports querying by preset reference', async () => {
		const found = await booted.payload.find({
			collection: 'swatches',
			where: { linkedStatic: { equals: 'preset:brand' } },
		})
		expect(found.docs.length).toBeGreaterThanOrEqual(1)
	})
})
